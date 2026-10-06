# Claude Code

这份是 `@anthropic-ai/claude-code@2.1.88` 的 source map 还原，用来学客户端循环。部分压缩实现在这棵树里是 stub，语义以 `src/query.ts` 的注释为准。

## query 循环

`QueryEngine.submitMessage` 组好提示后调用 `query()`，再进入 `queryLoop()` 的 `while (true)`。跨圈状态包括消息、工具上下文、自动压缩跟踪、输出 token 恢复次数、是否已经做过反应式压缩、待处理的工具摘要、stop hook 是否激活、圈数，以及上一圈的 `transition`。

每一圈在请求模型之前：

`getMessagesAfterCompactBoundary` → `applyToolResultBudget` → snip → microcompact → context collapse → autocompact → 拼系统提示和用户上下文。压力过高可以先以 `blocking_limit` 拦住。然后 `callModel` 流式返回。

流里收集到 `tool_use` 就标记需要下一圈。流结束后由 `StreamingToolExecutor` 或 `runTools` 执行，把工具结果、附件和队列通知拼回消息，圈数加一。没到 `maxTurns` 就以 `next_turn` 继续。

| 结束或续跑 | reason |
|---|---|
| 正常结束 | `completed` |
| 步数上限 | `max_turns` |
| 流式中止 / 工具中止 | `aborted_streaming` / `aborted_tools` |
| 钩子硬停 | `hook_stopped` / `stop_hook_prevented` |
| 模型或上下文错误 | `model_error` / `prompt_too_long` / `image_error` / `blocking_limit` |
| 续跑 | `next_turn`、`reactive_compact_retry`、`collapse_drain_retry`、`max_output_tokens_escalate`、`max_output_tokens_recovery`、`stop_hook_blocking`、`token_budget_continuation` |

6 步助手值得学显式的 `transition.reason`、工具后的 `next_turn`、硬顶 `max_turns`，以及把流式中止和工具中止分开。多层压缩加 stop hook 再续跑的组合过重。

## 流式工具

模型还在吐 `tool_use` 时，`StreamingToolExecutor.addTool` 就可以启动。`isConcurrencySafe` 为真、且当前正在跑的也都安全，才并行。只读的 Read、Grep、Glob、WebFetch、WebSearch 和只读 Bash 可以并行。Edit、Write 默认独占；队列里一个非安全工具会堵住后面的启动。结果仍按入队顺序交回。

Bash 出错只 abort 兄弟用的子控制器，不 abort 父级，这一轮不因此结束。换模型重试必须 `discard()` 并新建执行器，否则进行中的结果会带着旧的 `tool_use_id` 变成孤儿 `tool_result`。用户中止时 `getRemainingResults` 给排队和进行中的工具合成错误结果；没有流式执行器时走 `yieldMissingToolResultBlocks`。

办事插件里，查案件、查期限、查接口可以标成可并行。建流程、改字段、建任务和 `remember` 保持独占。

## 分层压缩

请求前的顺序是 snip、microcompact、collapse、autocompact。reactive 在接口报错之后。

| 层 | 做什么 |
|---|---|
| snip | 删中间消息段，保留 protected tail |
| microcompact | 旧工具结果正文换成占位，或用 cache edit |
| collapse | 分段折叠，摘要放在独立 store，读时再投影 |
| autocompact | 用模型摘要旧历史，保留近期；可先试 session memory |
| reactive | 上下文过长或媒体过大时的全量摘要兜底，只试一次 |

自动压缩阈值等于有效窗口减去 13000。有效窗口等于上下文窗口减去 `min(最大输出, 20000)`。连续失败 3 次后熔断，避免同一会话成千上万次空压。压缩后服务端只看见摘要，会低估已经花掉的上下文，所以要单独传压缩前的 remaining。

原文摘录助手该学的是保留颗粒、在摘要里留下用户原话。不该学的是删掉中段、清空工具正文，或整段用模型替换。

## 工具结果预算

按字符，不按条数。单条默认 5 万，再和工具自己的 `maxResultSizeChars` 取较小值。同一轮用户消息里全部工具结果合计 20 万。另有大约 10 万 token 乘 4 的字节兜底。超限时优先换掉最大的新结果。

全文写到会话目录的 `tool-results/<tool_use_id>`。对话里留大约 2KB 预览和路径。恢复会话时按 id 重放同一份预览，好让提示词缓存对得上。模型可以再按路径去读。

每个 `tool_use` 后面必须紧跟对应的 `tool_result`，否则接口 400。缺失时合成 `is_error: true` 的占位，内容写明中断或模型回退。`maxResultSizeChars` 为无穷大的目前只有 Read，避免「落盘后再读」死循环。带图片的结果也不落盘。

办事助手至少按单条 5 万字符截断；同一轮多条再加 20 万的合计预算。

## 权限

真正执行前走 `canUseTool`，默认决策来自 `hasPermissionsToUseTool`：规则、工具自己的 `checkPermissions`、模式、钩子和分类器。只有 `allow` 才继续。`ask` 再进弹窗。

`default` 和 `plan` 经常询问。`acceptEdits` 对工作区内的安全编辑自动允许，工作区外和 Bash、MCP 仍常询问。`bypassPermissions` 多数自动允许，但 `requiresUserInteraction`、内容级询问和安全检查仍会问。显式拒绝规则、`dontAsk` 和分类器拒绝直接 deny。

未允许时写入 `is_error` 的工具结果，这次不执行。用户拒批常用会要求停下的 `REJECT_MESSAGE`，并常常中止整轮。策略拒绝允许换工具，并写明不要绕过。下一轮模型仍可以再发工具调用。

「创建发文不能代点提交」适合在提交类动作上返回 deny，并写明原因；起草可以允许。若即使用户打开了 bypass 也必须本人确认，用 `requiresUserInteraction` 加询问，不用会中止整轮的拒批文案。

## 停止钩子

没有工具调用、即将结束时调用 `handleStopHooks`。主线程事件名是 `Stop`，子代理是 `SubagentStop`。输入包括会话、transcript、权限模式、上一条助手消息，以及 `stop_hook_active`。

`continue: false` 硬停，reason 是 `stop_hook_prevented`，不再请求模型，并且优先于 blocking。exit 2 或 JSON 的 `decision: "block"` 把反馈做成用户消息，reason 是 `stop_hook_blocking`，再请求一轮。其它非 0 只展示给用户。`stop_hook_active` 用来防止钩子死循环。

子代理不释放进程级的 computer-use 锁。那把锁是模块级变量，子代理若释放，主线程收尾会以为没有锁。

办事助手要用 block 再跑一轮来表达「自称完成但工具没成功」，不要用 `continue: false` 直接结束。

## 记忆预取与技能发现

每个用户回合入口启动一次 `startRelevantMemoryPrefetch`，和流式生成、工具执行并行。工具轮结束后，已经结算就注入，几乎不用再等；没结算就零等待跳过，下一圈再试。生成器退出时 abort。结果做成 `relevant_memories` 附件，包成 `isMeta` 用户消息，挂在本轮工具结果之后，供下一次请求看见。系统提示保持字节稳定。相关性召回最多选 5 条，并排除已经在系统提示里的 `MEMORY.md`、已经展示过的路径和已经读过的文件。禁止在预取时提前写入已读集合，否则会把自己滤空。

技能发现有两条。用户输入的第一圈没有并行工作可藏，仍然阻塞。回合之间的发现和主 turn 并行，多数在工具结束前已经完成。

前言里若只是最近 12 条摘要，按当前这句话做相关性召回仍然值得。若前言已经是全量正文，收益变小。

## MCP 刷新

同一次 API 请求内工具名单冻结。工具结果落下之后、下一圈之前，`refreshTools` 从 store 重新组装。后台连上新的 MCP 服务器后，下一圈才能看见新工具。连接失败返回 `failed` 或空列表，不抛穿主循环。`refreshTools` 本身只读 store，不再打网络。

子代理按名字引用服务器时，复用和父代理 memoize 的同一条连接，结束时不拆。内联定义才单独建连，结束时只清这些新客户端。

办事插件的工具名单是编译期固定的，没有「会话中途目录变长」的问题，这套刷新不用搬。

## 斜杠命令和技能

命令分三种。`local` 在本机执行，结果可以进 transcript。`local-jsx` 是终端 UI，一般不进模型。`prompt` 经 `getPromptForCommand` 扩成文本，当用户消息发给模型。

队列另有 mode：`prompt` 是用户插话，`task-notification` 是任务通知，`bash` 是命令。回合中途只消化前两种。以 `/` 开头的斜杠命令不在中途展开，等回合结束走 `processSlashCommand`。

索引只用 name 和 description，大约占上下文的 1%。整段正文在用户显式调用 `/技能名`，或模型调用 SkillTool 时注入。`context: fork` 则改由子代理跑。模型思考时的插话放进队列，在工具轮之后变成 `queued_command` 附件，不改系统提示。

「以 `/技能名` 开头只办这一件」应挂在 `processPromptSlashCommand` / `getPromptForCommand` 的出口，让正文整段进入这一轮。只改索引不够。

## 子代理

`runAgent` 生成 `agentId`，用 `createSubagentContext` 隔离后再走同一套 `query`。general-purpose 的工具是全部。Explore 和 Plan 禁止再派子代理，也禁止写文件。转录在 `subagents/agent-<id>.jsonl`，可以 resume。

`agentId` 为真时，主循环跳过延迟探测、工具摘要、进程级锁清理、周期任务摘要，以及 stop hook 里的记忆抽取。子代理默认不改主会话的界面和权限。办事步骤要改主会话，应挂在主循环的工具上。
