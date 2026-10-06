# OpenClaw（小龙虾）

嵌入式运行器把一轮对话收成一次 admitted run。入口在 `src/agents/agent-command.ts` 的 `agentCommand`，经 `runEmbeddedAgentAttempt` 进入 `src/agents/embedded-agent-runner/run-orchestrator.ts` 的 `runEmbeddedAgent`。`run.ts` 只做转发。会话准入、车道排队、模型 runtime 和 `before_agent_reply` 之后，主循环是 `run-loop.ts` 里 `runPreparedEmbeddedLoop` 的 `while (true)`。

## 一次 attempt

1. `beginRunAttempt` 记下本轮，并带上认证 profile 状态。
2. `prepareAndDispatchEmbeddedRunAttempt` 准备 workspace、提示词和 runtime plan，交给 harness 执行。
3. `normalizeEmbeddedRunAttempt` 收成 `complete`、`retry` 或 `proceed`。
4. `complete` 由 `providerReview.finish` 结束。`retry` 或操作者改了权限则 `continue`。其余走 `recoverEmbeddedRunAttempt`，再不行走失败收尾。`finally` 里 `settleEmbeddedRun`。

重试预算按 profile 数量计算，大约夹在 32 到 160 之间。每轮 `attemptsDispatched` 和 `attemptsCounted` 都加一，耗尽看 `attemptsCounted`。普通恢复、认证失败、助手失败算重试。`progress_continuation` 会把 counted 减回去，包括「有前进的截断续跑」和操作员权限续跑。前进和失败分开记账，正常的多步工具调用不会被当成故障烧尽额度。

## 车道

`resolveSessionLane` 得到 `session:<sessionKey>`，默认并发为 1，串行化同一会话的 turn 和压缩，避免工具调用和 transcript 交错。`resolveGlobalLane` 限制跨会话容量：普通走 `main`，cron 走 `cron-nested`，子代理走 `subagent:<owner>`。编排固定是先占 session 再占 global。同一会话的第二条消息在车道层排队，不并行，也不自动取消。产品层的 steer / interrupt 是另一套取消，和车道无关。超时和调用方的 `abortSignal` 一起传进 `enqueueCommandInLane`；排队期间 abort 可以拿掉队列项。压缩走同一条 session → global 嵌套。

单面板连发两条时，固定同一个 `sessionKey`，第二次必须等第一次结束，并把 abort 传进去。

## 上下文引擎

契约在 `src/context-engine/types.ts`。必选是 `info`、`ingest`、`assemble`、`compact`。`ingest` 写入引擎自己的消息库，可以空操作。`assemble` 按预算拼出本轮真正送给模型的消息。`compact` 做压缩、摘要或剪枝。可选还有 `bootstrap`、`maintain`、`afterTurn`、`commitTurn`，以及子代理的 `prepareSubagentSpawn`。

token 预算由 host 计算：上下文窗口减去预留和系统提示压力，再传给引擎。`promptAuthority` 只影响溢出预检用哪一份估计。`thread_bootstrap` 让有持久后端线程的 host 按 epoch 注入一次上下文；嵌入式 host 不用这条。

默认引擎 id 是 `legacy`。它的 ingest 是空操作，assemble 原样返回，compact 委托给 runtime。真正的裁剪仍在 attempt 管线里。小产品要学的是「拼装、回合结束、维护、压缩」这条生命周期，预算和 transcript 改写归 host。registry、隔离和 fallback 整套先不搬。

## 压缩与溢出

发请求前 `shouldPreemptivelyCompactBeforePrompt` 把压力分成四档：放得下、只截工具结果、只压缩、先压缩再截断。多数情况只记诊断。模型已经因 context overflow 失败后，`recoverEmbeddedRunOverflow` 走同一条恢复链，trigger 标成 `overflow`。

压缩成功后，引擎可以轮转会话：`acceptCompactionSuccessor` 在同一个 `sessionKey` 下换成新 `sessionId`，旧 transcript 经 `session_end` 归档。同会话则原地改写，然后重载压缩后的历史再发 prompt，并武装压缩后循环守卫。

熔断：本轮溢出压缩最多 3 次；provider 请求体超限则放弃压缩；摘要超时可以退到不调用模型的确定性裁剪；压缩后再出现同工具、同参数、同结果 3 次就中止这次 run。

只用原文摘录时，仍值得学预检路由（能截工具结果就不动历史）、确定性裁剪、压缩后的身份切换，以及压缩后的循环熔断。

## 工具死循环

`detectToolCallLoop` 看最近 30 次调用，可按 `runId` 过滤。hash 是 `工具名:sha256(稳定序列化的参数)`，`exec` 会去掉 `title`。

| 检测器 | 条件 | 阈值 |
|---|---|---|
| `generic_repeat` | 同工具同参数 | 警告 10，无进展硬停 20 |
| `known_poll_no_progress` | 轮询类同参数且结果无进展 | 警告 10，硬停 20；`wait` 的硬停是 10 |
| `argument_churn` | 同一工具多组参数，每组至少 3 次且结果相同、都无进展 | 总次数 ≥ 10 才警告，永不硬停 |
| `ping_pong` | 两套参数交替 | 警告 10，两侧结果都稳定则 20 硬停 |
| `unknown_tool_repeat` | 连续未知工具 | 10 次硬停 |
| `global_circuit_breaker` | 任意同工具无进展 | 30 次硬停 |

警告仍执行工具，把 System note 塞进结果，按 `floor(次数/10)` 去重。第一次 critical 否决这次调用并给恢复文案；再次 critical 则 `terminateRun`。

压缩成功后 `armPostCompaction`：窗口 3 次，基线是压缩前最近 16 次调用。窗口内同工具、同参数、同结果累计 3 次，就以 `compaction_loop_persisted` 中止。

6 步助手用缩小后的数字即可：历史记 8 条；同参数无进展警告 3、硬停 5；未知工具 3 次停；压缩后窗口 2，同结果连现 2 次即停。

## 工具钩子与结果

`runBeforeToolCallHook` 的顺序是：循环准入、技能或语音确认、trusted 策略、插件 `before_tool_call`、最终审批。它可以改参数，也可以要求审批。否决时写入 `status: "blocked"`。钩子自己抛错则 fail-closed。允许名单在调用前就把工具从目录里滤掉。

`truncateToolResultText` 保留头和诊断尾，中间省略。合计预算大约是上下文窗口的一半：先压超标单条，再省略旧结果。有 spill 路径就指向完整输出。发给模型的是投影，canonical transcript 尽量不改。

`createAgentTurnTaintState` 在本回合出现非展示用的网络工具结果时把这一轮标脏，并跨重试继承。效果是记忆写入标成 `untrusted`，防止网络内容被当成主人说过的话落库。没有可见回复时，`buildFailureWarning` 强制报失败。办事助手最该学的是：执行前能拒绝就拒绝，并留下明确的 blocked 或 failed，不要静默当成成功。

## 失败分类

`FailoverReason` 至少包括限流、过载、认证、永久认证失败、上下文溢出、超时，另外还有账单、服务端错误、格式、证书、模型不存在、会话过期。大约 429 是限流，401/403 是认证，408 和部分 5xx 是超时，529 是过载。溢出常常是独立的 `context_overflow`。

认证失败优先换 profile。配置了 fallback 且 profile 转不动再换模型。`context_overflow` 走压缩后重试，不写 profile 健康。限流、过载、超时先同模型退避。溢出压缩最多 3 次，超时压缩最多 2 次，限流或过载的 profile 轮换各 1 次。

单模型插件最少要做的是把错误分成限流、过载、认证、溢出、超时，让核心决定退避、回退或压缩。凭据轮换本身不必自建。

## 记忆

源文件是工作区的 `MEMORY.md`、`USER.md` 和 `memory/**/*.md`。索引是每个 agent 一份 SQLite，含全文检索和可选向量，块大约 400 token。检索默认是向量 0.7 加文本 0.3，再做 30 天半衰期的时间衰减、重要度加权和 MMR。默认最多 6 条，最低分 0.35。引用格式是 `path#L起-L止`。

写入带 `originClass`：`owner`、`agent`、`untrusted`、`system`。自动注入只用 `owner` 和 `agent`。长期记忆和当轮压缩摘要是两回事；压缩前有一次静默的 memory flush，把要记住的内容追加到记忆文件，这段维护 transcript 不进后续用户轮。

没有「只能记用户原话或工具返回」的硬规则。同轮助手内容可以记成 `agent`，网络工具可以把这一轮污染成 `untrusted`。这比 PatMail 的规则更宽。

## 技能

含 `SKILL.md` 的目录从工作区 `skills`、`.agents/skills`、用户目录、状态目录、workshop 和内置包里发现，根下最多 6 层。必填 `name` 和 `description`。系统提示里只放 `<available_skills>` 索引：名字、描述、位置，并有条数和字符预算。正文靠模型按路径去读。

用户用 `/技能名` 或 `$技能名` 时，展开成「先读这些 SKILL.md」。`disable-model-invocation` 只从索引里藏起来，显式引用仍然有效。`command-dispatch: tool` 可以绕过模型直接调工具。模型自己选技能时，只看描述，再按需读全文。

## 子代理

持有 `sessions_spawn` 的 main 或 orchestrator 可以派生。leaf 没有这个工具。子会话键是 `agent:<id>:subagent:<uuid>`，默认空转录，也可以 fork 父转录。子代理再收紧工具：固定拒绝 gateway、message、sessions_send 等；leaf 再拒绝继续 spawn。默认最大深度 5，每个控制器最多 5 个子代理，全局子并发默认 8。

结束后默认 announce 回父会话。`collect=true` 则不通知，等父显式收集。父用 `sessions_yield` 等结果。适合边界清楚、可以并行、交付物明确的任务。单次查询和必须改主界面的步骤不适合。
