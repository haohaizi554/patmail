# Claude Code 的 agent 循环

源码在 `claude-code/`。这一份从公开 npm 包的 source map 还原，版权归 Anthropic，笔记只记录机制。

主循环在 `src/query.ts`。每一圈先收上下文，再请求模型；有工具就执行并带上附件，没有工具就过停止钩子。工具结果过大时按 `tool_use_id` 落盘，上下文里只留预览。

## 主循环

`query` 把控制权交给 `queryLoop`。`queryLoop` 是 `while (true)`。跨圈事实放在一个 `State` 上：`messages`、`toolUseContext`、`autoCompactTracking`、`maxOutputTokensRecoveryCount`、`hasAttemptedReactiveCompact`、`maxOutputTokensOverride`、`pendingToolUseSummary`、`stopHookActive`、`turnCount`、`transition`。循环外还有任务预算余量，以及一轮只启动一次的记忆预取。

每一圈的顺序：

1. 解开上一圈的 `State`。
2. 收上下文：工具结果预算、snip、microcompact、collapse、autocompact。
3. `deps.callModel` 流式请求模型。
4. 没有 `tool_use`：走输出上限恢复、停止钩子、token 预算。
5. 有 `tool_use`：`runTools` 或 `StreamingToolExecutor` 执行工具，再拼附件、排队命令、记忆和技能。
6. 装好下一圈的 `State`，回到 `while`。

继续下一圈的原因包括：collapse 排空后重试、reactive compact、输出 token 上限升级、停止钩子挡住结束、token 预算要求续跑，以及正常的 `next_turn`。模型中途换备用模型时，内层也会 `continue`，那一次不更换整个 `State`。

结束时返回明确原因：`blocking_limit`、`image_error`、`model_error`、`aborted_streaming`、`prompt_too_long`、`completed`、`stop_hook_prevented`、`aborted_tools`、`hook_stopped`、`max_turns`。API 错误也会走 `completed` 这条退出，避免「出错、钩子再逼一轮、再出错」。

`maxTurns` 只在本圈工具已经跑完、即将再进一圈时检查。`nextTurnCount = turnCount + 1`，超过上限就返回 `max_turns`。第一圈从 1 开始。模型直接给出正文时不走这个检查。

办事助手要学的是这个形状：一轮用户意图留在外层循环里；每一圈是收上下文、调模型、有工具就执行再问一次；终止原因写成枚举。步数上限卡在「工具完成、准备再来一轮」的边界上。

## 工具结果预算

`applyToolResultBudget` 的持久化在 `src/utils/toolResultStorage.ts`。

预算有两层。单个工具有 `maxResultSizeChars`，外面再夹一层大约 5 万字符的默认。同一轮、同一条 API user 消息里，并行 `tool_result` 的字符总和默认大约 20 万，按消息组单独算，不跨轮累加。

超限时按体积从大到小处理。全文写到会话目录 `tool-results/{tool_use_id}.txt` 或 `.json`。对话里换成带路径和大约 2KB 预览的标记。`ContentReplacementState` 用 `tool_use_id` 记住替换文本。恢复会话时贴回同一段预览，保证字节一致。模型要看全文，按路径再读。

这一步必须放在 microcompact 之前。带缓存的 microcompact 只认 `tool_use_id`，不看正文。先替换内容，两层才能叠在一起。放过的以后不再改，替换过的每一轮都贴同一段预览。按正文去匹配，预览模板一变就会打穿提示词缓存，也会破坏工具调用和结果的配对。

不参与预算的有：`maxResultSizeChars` 为无限的 Read、含图片的结果、已经落盘的结果，以及功能旗关闭时的整条预算。Read 被排除，是为了避免「读文件、把全文存成指针、再读那个指针」。

查客户、案件、期限时，超限应先裁掉最大的几块。上下文里留短摘要和稳定 ID。

## 分层收缩

请求前的顺序是：工具结果预算、snip、microcompact、collapse、autocompact，然后才是 API。上下文过长或媒体超限被扣住之后，先做 collapse 排空，再试一次 reactive compact。

本仓库里 `snipCompact.ts` 和 collapse 是桩，`reactiveCompact.ts` 不在这份还原里。行为以 `query.ts` 的调用顺序，以及仍然完整的 `src/services/compact/autoCompact.ts`、`microCompact.ts`、`compact.ts` 为准。

| 层 | 做什么 | 是否调模型 |
|---|---|---|
| snip | 裁中间历史，保留保护尾部 | 否 |
| microcompact | 清掉旧的可压缩工具结果；热缓存走 cache edit | 否 |
| collapse | 分段折叠，尽量保住粒度 | 提交摘要时会；本仓库是空操作 |
| autocompact | 旧对话收成摘要，留下近期 | 是 |
| reactive | 报错之后的摘要型压缩；媒体错误还可以剥图 | 是 |

自动压缩的有效窗口等于模型上下文减去输出预留，预留是 `min(最大输出, 20000)`。触发阈值再减去 13000。snip 省下的 token 要单独传入，因为尾部那条助手消息上的用量还是旧值。连续失败达到 3 次后，这次会话不再试自动压缩；成功则清零。

Reactive compact 最多试一次。流式路径先扣住「提示太长」和媒体尺寸错误，不立刻抛给用户。413 先排空 collapse；仍然失败才 `tryReactiveCompact`。媒体错误跳过 collapse，因为它不剥图。`hasAttemptedReactiveCompact` 在尝试后置真，避免「压完仍然太长、再压」的死循环。

压缩后服务端只看得见摘要，会低估已经花掉的预算。客户端在压缩前记下当时的上下文长度，累加到 `taskBudget.remaining`，再传回 API。

只用原文摘录的助手，可以学 snip 和 microcompact：删掉又大又旧的工具输出，不调模型。整段语义改写才需要 autocompact。

## 流式工具

`src/services/tools/StreamingToolExecutor.ts` 在模型还在输出时，就按到达的 `tool_use` 入队。`isConcurrencySafe(input)` 为真，并且当前没有独占工具在跑，就可以并行。解析失败或抛错，当成独占。默认实现返回假。

只读的读文件、搜索、抓取可以并行。写文件、认证、非只读的 Bash 必须独占，并且会挡住后面的队列。执行可以乱序完成，交回时按入队顺序：前面没完成，后面已经完成的也不交出。进度消息可以立刻吐出。

流式回退时 `discard()` 丢掉旧执行器，换一个新的，避免旧的 `tool_use_id` 漏进重试。用户中止时，`getRemainingResults()` 给还在排队或执行的调用补上错误形态的 `tool_result`。Bash 失败只会中止并行的兄弟进程，不中止父回合。权限拒绝才会冒泡到父控制器。

办事助手的查询若要并行，最小条件是：只读、没有共享的可变副作用、失败不要误伤兄弟。写工作流和建任务保持独占。

## 记忆预取

`src/utils/attachments.ts` 的 `startRelevantMemoryPrefetch` 在进入 `while` 之前启动一次，不 await。它按当前用户的话去检索记忆文件，大约最多 5 个。消费点在本圈模型流和工具都结束之后：已经完成才注入；没完成就零等待跳过，下一圈再试。回合结束会中止还没回来的预取。模型请求在消费点之前就已经发出，所以它不挡第一个 token。

`filterDuplicateMemoryAttachments` 用累计的 `readFileState` 去掉模型已经读过或写过的文件，也去掉先前注入过的记忆。

技能发现是同一模式，但是每一圈都启动一次。记忆预取是一轮用户意图只启动一次。

固定的近 12 条事实、没有可检索的记忆文件时，这套预取收益有限。有长期记忆文件、要按问题召回时，值得做成不挡首 token 的预取。

## 停止钩子

模型不再调工具时进入 `src/query/stopHooks.ts` 的 `handleStopHooks`。钩子看得到会话、转录路径、权限模式、`stop_hook_active`，以及最后一条助手纯文本。`stop_hook_active` 为真，表示这一轮已经因为拦截再进来过。

退出码 2，或 JSON 里 `decision` 为 `block`，会拼成一条「Stop hook feedback」的元用户消息，以 `stop_hook_blocking` 再开一轮。`continue: false` 则是 `stop_hook_prevented`，直接停。用户中止也按硬停处理。

子代理不释放主线程的电脑使用锁。那把锁是进程级的，子代理放掉会让主线程以为自己没拿着。

办事助手可以用同一形状做收尾检查：必调工具没出现，或交付物不齐，就拦截并再给一轮；已经达标，或用户要求停下，就硬停。用 `stop_hook_active` 防止二次再入。

## 权限

一次工具调用的结论是允许、询问或拒绝。允许可以改写入参。询问等人确认。拒绝必须带原因。内部的 passthrough 在汇总时收成询问。用户点拒绝时，决议形状常常是询问加上拒绝文案，执行侧对非允许一视同仁。

权限没通过时不执行工具，而是写一条 `tool_result`：同一个 `tool_use_id`，内容是拒绝原因，`is_error` 为真。这样不会留下孤儿工具调用。

计划模式靠提示把模型留在只读和计划文件里，真正开工前要人批 `ExitPlanMode`。默认模式对危险操作询问。接受编辑模式对工作区内的编辑更容易放行。不询问模式把本该询问的改成拒绝。

「创建发文和提交审核不能代点」必须放在权限硬拦截上：规则或工具的 `checkPermissions` 返回拒绝，并且对绕过模式也生效。提示词只能降低误触。模型仍然可以发出工具调用，只有权限层不放行，动作才不会执行。

## 斜杠命令和技能

以 `/` 开头的输入先在本地走 `processSlashCommand`，不先当闲聊交给模型。命令分三类。`local` 在本机执行，不查模型。`local-jsx` 打开本地界面，默认也不查。`prompt` 是技能：展开正文后 `shouldQuery` 为真，再进主循环。未知但像命令名的报错并且不查模型；像路径的退回普通用户消息。

技能正文在用户显式 `/技能`，或模型调用技能工具时注入。它是一条 `isMeta` 的用户消息，并带上命令权限附件。实验性的技能发现预取注入的是发现附件，不是整份技能正文。

回合之间，斜杠和 bash 先出队再执行。回合之中，`query.ts` 的快照排除 `isSlashCommand`，斜杠要等这一回合结束再解析，避免被当成正文送进模型，也被避免中途抽走两次。

`patmail-extension` 的 `/技能名` 目前是解析之后把说明附在用户句后面。官方形态是注册成 prompt 命令，本地拆开名字和参数，正文单独作为元消息注入，再查模型。

## 工具名单刷新

本圈请求用的是 `toolUseContext.options.tools` 的快照。工具跑完、附件处理完、递归进下一圈之前，才调用 `refreshTools()`。名单变了，进的是下一圈，不是当前圈中途改表。

新连上的 MCP 服务器异步写入连接库。本圈采样已经锁定旧名单。单台服务器连接失败记为失败、工具为空，不拖垮主回合。

固定名单的插件仍然可以学两件事：发现和采样解耦，失败隔离开；检索类工具可以晚到，办理类工具保持稳定暴露。

## 子代理

子代理复用同一套 `query()`，不是另一套引擎。`runAgent` 经 `createSubagentContext` 注入自己的 `agentId`、工具和模型，再 `for await` 消费 `query`。转录写到会话目录下的 `subagents/agent-<id>.jsonl`，和主会话分开。

Explore 只读搜代码，禁止写、禁止再套子代理。Plan 做只读规划。general-purpose 用全套工具做多步工作，向父代理汇报要点。Verification 做对抗验证，不改项目树。fork 共享父上下文，用来保住提示词缓存前缀。

`agentId` 有值时，跳过主线程的任务摘要、电脑使用清理，以及记忆抽取。子代理是短生命周期的侧链，没有主会话的权限界面和用户输入流。办事应留在主会话或插件里。
