# Claude Code 运行时

循环、压缩层次、权限和停止钩子见 [claude-code.md](claude-code.md)。这篇写这个客户端除此之外的骨架。仓库是 `@anthropic-ai/claude-code@2.1.88` 的 source map 还原，部分内部包在这棵树里是 stub，以文件职责和调用关系为准。

## 它是客户端，不是网关

没有「一台机器长期握着所有聊天渠道」的进程。一次 `claude` 是一个本地客户端：读工作区、改文件、跑命令、接 MCP、把 transcript 写在项目目录里。远程能力在 `src/bridge` 和 `src/remote`，是这条客户端向外伸的桥，不是 OpenClaw 那种渠道枢纽。

顶层目录可以按职责分成四圈：

| 圈 | 目录 | 做什么 |
|---|---|---|
| 回合 | `query`、`QueryEngine.ts`、`services/api`、`services/compact` | 请求模型、执行工具、收缩上下文 |
| 工具 | `tools`、`services/tools`、`services/mcp` | 改仓库、查网页、接外部服务器 |
| 界面 | `components`、`ink`、`screens`、`commands`、`vim`、`voice` | 终端 UI、斜杠命令、按键、语音 |
| 协作 | `coordinator`、`tasks`、`tools/AgentTool`、`bridge` | 子代理、任务、团队、远程 |

旁边还有 `hooks`、`skills`、`memdir`、`plugins`、`state`、`bootstrap`、`entrypoints`。`buddy` 是伴侣界面，不参与工具循环的正确性。

## 工具面

`src/tools` 下的目录就是模型能调用的产品面，比循环策略更接近「Claude Code 会干什么」：

- 仓库：`FileReadTool`、`FileEditTool`、`FileWriteTool`、`NotebookEditTool`、`GlobTool`、`GrepTool`、`LSPTool`
- 命令：`BashTool`、`PowerShellTool`、`REPLTool`
- 网络：`WebFetchTool`、`WebSearchTool`
- 计划：`EnterPlanModeTool`、`ExitPlanModeTool`、`VerifyPlanExecutionTool`、`BriefTool`
- 工作区隔离：`EnterWorktreeTool`、`ExitWorktreeTool`
- 代理：`AgentTool`（含 explore、plan、general-purpose 等内置角色）
- 任务和团队：`TaskCreateTool`、`TaskGetTool`、`TaskListTool`、`TaskUpdateTool`、`TaskStopTool`、`TaskOutputTool`、`TeamCreateTool`、`TeamDeleteTool`、`SendMessageTool`、`TodoWriteTool`
- 技能和发现：`SkillTool`、`ToolSearchTool`、`WorkflowTool`
- MCP：`MCPTool`、`ListMcpResourcesTool`、`ReadMcpResourceTool`、`McpAuthTool`
- 其它：`AskUserQuestionTool`、`ConfigTool`、`ScheduleCronTool`、`SleepTool`、`RemoteTriggerTool`、`SuggestBackgroundPRTool`、`SyntheticOutputTool`

只读工具把 `isConcurrencySafe` 标成真，流式执行器才会并行。写文件、改笔记本、跑有副作用的 Bash 默认独占。`ToolSearchTool` 的存在说明工具名单可以长到不适合一次全塞进提示词，模型先搜索再调用。办事插件的十来个工具用不到这一层。

## 服务层

`src/services` 是循环旁边的能力，不是第二个 agent：

- `api`：流式和非流式请求、模型回退
- `compact`、`contextCollapse`：请求前的收缩和报错后的兜底
- `mcp`：连接、列工具、失败时返回空而不打断主循环
- `tools`：真正执行、流式执行器、编排
- `oauth`、`settingsSync`、`remoteManagedSettings`：登录和设置
- `lsp`：语言服务
- `SessionMemory`、`extractMemories`、`teamMemorySync`、`autoDream`：会话记忆、抽取、团队同步、后台整理
- `AgentSummary`、`toolUseSummary`、`PromptSuggestion`、`tips`：给界面和 `claude ps` 的摘要，不是给模型的事实来源
- `analytics`、`policyLimits`、`plugins`：用量、策略上限、插件

记忆预取和技能发现挂在 `query.ts`，实现散在 `utils/attachments.ts`、`memdir/` 和技能搜索。它们和 `extractMemories` 不是同一条路径：预取是这一轮给模型看的附件，抽取是回合结束后的副作用。

## 斜杠命令

`src/commands` 大约有 100 个命令文件。类型分三类，见循环笔记：本机执行、终端 UI、变成提示词。以 `/` 开头的命令不在模型思考中途展开，等这一回合结束再走 `processSlashCommand`。中途插话走队列，在工具轮之后变成附件。

技能平时只占索引（名字和描述，大约上下文的 1%）。用户点名或模型调用 `SkillTool` 时，`getPromptForCommand` 把 `SKILL.md` 正文变成用户消息。`context: fork` 则改由子代理执行。

## 权限和计划

执行前的决策是 allow、ask、deny，见循环笔记。模式改变的是默认倾向，不是取消这道门：

- `default`：多数写操作和命令要问
- `plan`：先计划，退出计划模式本身可以要求用户在场
- `acceptEdits`：工作区内的安全编辑可以自动过，工作区外和命令仍常问
- `bypassPermissions`：多数自动过，但标了必须用户参与的工具、内容级规则和安全检查仍然问
- `dontAsk`：本来要问的改成拒绝

用户点拒绝常用会要求停下的文案，并可能中止整轮。策略拒绝写成工具错误，允许换一条路，不允许绕过。子代理用另一套拒绝文案，因为子代理不能替主会话做主。

计划模式和 worktree 是编码产品的两道隔离：先把要改什么说清楚再改；把改动放进单独的 git worktree，而不是直接写当前分支。`VerifyPlanExecutionTool` 要求计划执行之后有核对，和 Hermes 的 verify-on-stop 同类，但是一个显式工具，不是文本结束时的闸门。

## 子代理、任务、团队

`AgentTool/runAgent` 生成 `agentId`，用 `createSubagentContext` 包一层，再调用同一个 `query`。转录在 `<项目>/<会话>/subagents/agent-<id>.jsonl`，旁边有元数据，可以 resume。general-purpose 工具是全部。Explore 和 Plan 去掉写工具和再派子代理。verification 限制改项目文件。

主循环看见 `agentId` 就跳过只属于主线程的事：延迟探测、工具调用的小模型摘要、进程级 computer-use 锁的清理、周期任务摘要、stop hook 里的记忆抽取。锁是进程级变量。子代理若去释放，主线程会以为自己没拿过锁。

任务工具和团队工具是另一层协作：创建任务、列出、更新、停止、读输出，以及建团队、删团队、给同伴发消息。这和 OpenClaw 的 `sessions_spawn`、Hermes 的 `delegate_task` 同类，但绑定在编码会话的任务板上，而不是聊天渠道的子会话。`src/coordinator` 和 `src/tasks` 是这层的运行时，不在 `queryLoop` 里面。

## 钩子

停止钩子只是钩子面的一个事件。`src/hooks` 和 `src/utils/hooks` 还覆盖工具前后、会话和命令。Stop 与 SubagentStop 的差别见循环笔记：`continue: false` 硬停且不再请求模型；exit 2 或 `decision: block` 把反馈塞成用户消息再跑一轮。`stop_hook_active` 防止钩子自己把循环撑死。

## 这棵还原树里不完整的部分

snip、collapse、reactive compact 的部分实现是占位，语义写在 `query.ts` 的注释里。技能搜索的部分目录被裁掉，调用点还在。原生模块（屏幕、键鼠、部分平台绑定）不在 TypeScript 树里。因此这份笔记可以用来理解客户端如何组织一轮编码，不能当成可替换官方安装包的构建说明。

## 和另外两家比，多出来的是什么

多出来的是围绕一个仓库的交互：计划模式、worktree、LSP、补丁和笔记本、权限弹窗、100 个斜杠命令、任务板和团队消息、把大工具结果落盘后再读。少掉的是渠道网关、设备配对、profile 级的消息路由，以及「同一会话键在多天里被许多人发消息」那种会话模型。
