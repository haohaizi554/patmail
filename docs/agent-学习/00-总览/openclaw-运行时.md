# OpenClaw 运行时

循环本身见 [openclaw.md](openclaw.md)。这篇写 Gateway、提示词、钩子、算力池和工具面。材料来自仓库里的 `docs/concepts/architecture.md`、`docs/concepts/agent-loop.md`、`docs/concepts/system-prompt.md`、`docs/agent-runtime-architecture.md`，以及 `src/` 的目录划分。

## 一台主机一个 Gateway

长期进程是 Gateway，不是每次聊天拉起的 CLI。它持有各渠道连接：WhatsApp（Baileys）、Telegram（grammY）、Slack、Discord、Signal、iMessage、WebChat。控制面（macOS 应用、CLI、Web 管理）和节点（macOS / iOS / Android / headless）连的是同一条 WebSocket，默认 `127.0.0.1:18789`。节点在 `connect` 里声明 `role: node`，并带上自己能做的命令，例如 `camera.*`、`screen.record`、`location.get`。macOS 应用还有 `canvas.*`。

一台主机只有一个 Gateway，也只有它去打开 WhatsApp 会话。同一端口还提供 `/__openclaw__/canvas/` 和 `/__openclaw__/a2ui/`。

协议是文本帧 JSON。第一帧必须是 `connect`，否则直接关掉。之后请求是 `{type:"req", id, method, params}`，事件是 `{type:"event", event, payload}`。事件不重放。客户端发现序号有缺口，要自己重新拉快照。有副作用的方法（`send`、`agent`）带幂等键，服务端有短时去重。

所有连接都要签 `connect.challenge` 的 nonce。新设备要配对，通过后发设备令牌。本机回环可以自动批准。Tailnet 和局域网即使是本机绑定，也要显式批准。`gateway.auth.mode: "none"` 只适合私有入口。

## agent 请求是异步的

CLI 走 `openclaw agent`。渠道和客户端走 RPC `agent` 和 `agent.wait`。

`agent` 校验参数、解析 `sessionKey` 或 `sessionId`、写下会话元数据，立刻返回 `{ runId, acceptedAt }`。真正的回合在 `agentCommand` 里跑：解析模型、思考级别、技能快照，调用 `runEmbeddedAgent`。若嵌入循环自己没发出结束事件，`agentCommand` 会补一条 lifecycle 的 end 或 error。

`subscribeEmbeddedAgentSession` 把运行时事件分成三条流：`assistant`（增量）、`tool`（工具开始、更新、结束）、`lifecycle`（`start`、`finishing`、`end`、`error`）。`agent.wait` 按 `runId` 等终态，返回 `ok`、`error` 或 `timeout`。Gateway RPC 还会等终态回放发布完，这样重复请求可以再拿到同一次结果。

聊天通道把 assistant 增量收成 `delta`，把终态收成 `final`、`error` 或 `aborted`。明确的取消和超时马上收尾。可重试的错误留 15 秒，等同一次 run 的回退或重启。外层尝试全部结束后会标 `executionSettled: true`，Gateway 看到后不再给宽限。审计账本只记来源和结果码，不复制提示词、消息、工具参数和原始错误。

## 写入权

流开始前，这次 admitted run 记下持久的 `activeWriterRunId`。之后每一次 transcript 追加或改写都带 `expectedWriterRunId`，提交事务里核对它仍然是当前持有者。被替换的 run 不能把过期内容写进去。每个 agent 的 SQLite 写入另有队列。Gateway 的状态目录锁保证另一个 Gateway 或 `openclaw agent --local` 不能同时拥有同一份状态目录。

沙箱运行可以把工作区指到沙箱根。技能用快照，避免一轮中途目录变化。bootstrap 文件在系统提示定稿前注入。压缩、截断和改写使用同一道写入围栏。

## 队列模式和回复

车道保证同一 `sessionKey` 串行，见循环笔记。渠道在车道之外还有队列模式：steer、followup、collect、interrupt，决定新消息是插进当前轮、排到后面、收成一批，还是打断。

精确的静默记号 `NO_REPLY` 会从对外载荷里滤掉。它表示空输出，不表示可以跳过一次必须回答的回合。私聊和被点名的群消息默认要有答复。未点名的群消息只有在操作者打开静默策略时才可以不答。环境事件和内部辅助回合可以不答。

必须回答的回合如果工具都跑完了却没有正文，可以再做一次不带工具的收尾。已经完整送达的进度消息，只有在它是最后一批工具、而且之后没有新工具时，才算答复。更晚的工具工作仍会触发这次收尾。这次收尾不重复已经完成的工具。被拒绝的执行仍然是失败，即使收尾写出了一段话。可选回合若明确以 `NO_REPLY` 结束，不再额外请求模型。

消息工具已经把回复发出去之后，最终载荷里会去掉重复的助手确认。有用户可见回复时，不再追加「工具失败」警告。没有可见回复、而回合死在工具失败上时，警告是强制的，不能配置关掉。

OpenAI Responses 上，`response.completed` 只结束这一次模型响应。提供商若给出 `end_turn: false`，循环会再要一次响应，哪怕这次只有文字。取消和宿主主动停止仍然有效。每条响应在助手消息的 diagnostics 里留下 `openai_responses_terminal`，记下 `endTurn` 是 true、false、absent 还是 invalid。这是提供商信号，不是宿主有没有拦住续跑。

输出 token 用尽且当时正在生成工具调用时，已经准入的工具会跑完，未完成的那次调用不执行，然后从已有结果重试。拒绝和不一致的终态不走这条续跑。

## 系统提示

没有一份运行时默认提示词。三层组装：

- `buildAgentSystemPrompt` 只做渲染，不读全局配置。
- `buildConfiguredAgentSystemPrompt` 套上这个 agent 的配置：主人显示名、语音提示、模型别名、记忆引用模式、委派模式。
- 各运行时适配器收集当下事实（工具、沙箱、渠道能力、上下文文件、提供商贡献）再调用上面的门面。

固定段落包括：工具使用、执行倾向、承诺的后续工作、小心处理配置和凭据、运行时上下文、技能、OpenClaw 控制面、消息路由、工作区、文档、沙箱、时间、输出指示、界面呈现、运行时一行、推理可见性。

执行倾向写的是：能用工具办的事就在这一轮办完，弱结果要恢复，改状态之前先看现场，结束前要核对。风险由工具策略、沙箱和 exec 审批挡住，提示词不要求模型事先拒绝。

承诺的后续工作必须在结束前安排完成或看守路径。`running` 不算完成。将来再看、提醒、周期任务用 cron，不用 `exec` 里 sleep，也不用反复 poll `process`。较大的任务用 `sessions_spawn`。子任务结束只说明那一次子 run 结束，不说明用户的目标已经完成。

大段稳定内容，包括项目上下文和记忆召回的静态说明，放在内部缓存边界之上。界面、消息、群聊、反应、运行时、项目记忆事实、当前提权级别放在边界之下。正在跑的 exec、子代理和媒体任务不写进系统提示，而走稍后的运行时上下文载体，这样对话历史的前缀也能复用。时间放在边界之下，精确时刻用 `session_status`。提供商插件可以替换 `interaction_style`、`tool_call_style`、`execution_bias` 三段中的一段，或在边界上下各注入一段，而不换掉整份提示词。

节点上的会话用同一套提示词和 bootstrap。Gateway 选指令、人格、技能、记忆和隐私策略。节点只提供自己的工作区路径、主机、系统和 shell。上下文引擎的选择、历史准备和回合结算仍归 Gateway。

`agents.defaults.subagents.delegationMode` 未设置时，主会话是 `prefer`，其它会话是 `suggest`。`prefer` 会加一段委派说明：内部杂务用隐藏子代理，用户会跟看的工作用可见侧栏。这只是提示词。工具策略仍然决定 `sessions_spawn` 在不在。思考级别到 ultra 且可以 spawn 时，再加一段并行编排：独立的调查、实现、核对分给子代理，简单或紧耦合的留在本地。

## 两套钩子

进程内有两套，和对外的 HTTP webhook 不是一回事。

内部钩子是 `HOOK.md`，跟命令和生命周期走，例如 `command:new`、`command:reset`、`command:stop`。`agent:bootstrap` 在系统提示定稿前增删 bootstrap 文件。

插件钩子是类型化的 `api.on`。和循环相关的有：

| 钩子 | 时机 |
|---|---|
| `before_model_resolve` | 还没有消息，用来改提供商和模型 |
| `before_prompt_build` | 会话已加载，可前置上下文或收窄工具面 |
| `before_agent_reply` | 模型调用前，插件可以自己回复或让这轮沉默 |
| `agent_end` | 结束后，带最终消息和运行元数据 |
| `before_compaction` / `after_compaction` | 只观察，不能改写或否决压缩 |
| `before_tool_call` / `after_tool_call` | 拦截参数和结果 |
| `tool_result_persist` | 写入 transcript 之前同步改写工具结果 |
| `message_received` / `message_sending` / `message_sent` | 进出消息 |
| `session_start` / `session_end` | 会话边界 |
| `gateway_start` / `gateway_stop` | Gateway 生命周期 |

`before_tool_call` 里 `{ block: true }` 会停掉更低优先级的处理器。`{ block: false }` 不会撤销已经有的拦截。`message_sending` 的 `cancel` 同样。安装允许还是拦截走 `security.installPolicy`，不靠 `before_install`，这样 CLI 安装和更新也盖得住。

## Harness 和模型快照

内置运行时 id 是 `openclaw`，旧名 `pi` 会归一成它。`codex-app-server` 归一成 `codex`。插件可以再注册 harness。`auto` 选择支持当前提供商路线的插件 harness，否则用内置。单凭模型名前缀不会选 harness。官方 OpenAI Responses 或 ChatGPT Responses 的精确 HTTPS 路线可以隐式选 `codex`。补全适配器、自定义端点和带手写请求行为的路线留在 `openclaw`。明文的官方 HTTP 会被拒绝。

Gateway 启动，以及配置、插件或认证发布时，每个已配置的 agent 做一份模型运行时代际：认证模板、模型注册表、投影后的目录，合成一次原子快照。真正的 run 从这份快照叉出可变的认证和注册表。浏览、状态、cron、doctor、TUI、PDF 和图像走已发布的目录，不再各自扫文件系统。失败或过期的代际不会和更新的半份代际一起提供。租约带上这次准备好的选择，重试必须看到持有者或发布门变了，否则返回可重试错误，而不堵住 Gateway 事件循环。

Codex app-server 的回合由原生 Codex 拥有存活和 `turn/completed`。安静时段和助手输出本身不结束回合。插件钩子仍是文档化表面的兼容合同。Codex 自己的原生钩子是更底层的另一套。

## 算力池

代码模式执行、压缩规划和文件工具规划用 `WorkerTaskPool`，协议在 `@openclaw/worker-runtime`。宿主适配器负责创建原生 worker、资源托管和进程记账。任务结果、执行结算和资源释放是三件分开的事：结果可以先返回，worker 和输入配额仍由主人持有。

这些池在当前 isolate 里共享 CPU 准入，上限是 `max(1, 可用并行度 - 1)`，尽量给 Gateway 留一个核。数据库和模型代际 worker 保持自己的上限。文件工具 worker 只做匹配、Unicode 规范化和 diff。调用方保持变更队列、文件系统、写入后校验和权限检查，规划完成后再核对一次权限和取消，然后才改文件。

每个池默认 128 个等待任务、256 MiB 调用方申报的输入。超出返回 `WorkerTaskError.code = "overloaded"`。取消要等 worker 停下并且异步的输入准备结束，才释放执行许可和输入预留。空闲 worker 会释放 CPU 并在超时后退役。

## 调度

Gateway 内核有一个 `GatewayScheduler`。维护和 cron 向它登记，一个宿主定时器负责下一次唤醒。持久工作的截止时间留在各自的 store 里，启动时由主人重建，不另存一份调度器状态。睡眠醒来后，每个到点登记只派发一次。周期任务等回调和它跟踪的工作结束才开始下一间隔，漏掉的 tick 合并。`beginClose()` 停止接收新的调度并取消尚未开始的唤醒。`stop()` 等已经在跑的回调。请求级超时、流内定时器和子进程清理由各自的操作主人持有。SQLite 的 WAL checkpoint 定时器归存储主人。

## 工具面

`docs/tools` 里能看到产品工具，而不只是循环里的策略。大致是这些族：

- 执行：`exec`、审批、提权、后台 `process`、代码执行、code mode、apply patch、diff
- 网页：web fetch，以及 Brave、Exa、Tavily、Perplexity、DuckDuckGo、Gemini、Grok、Kimi、MiniMax、Ollama、SearXNG、Parallel、Firecrawl
- 浏览器和屏幕：browser、chrome 扩展、screen、登录态
- 媒体：图像、音乐、视频、PDF、TTS
- 会话：session、session 工具、子代理、swarm、yield 交接、agent send
- 人机：ask user、steer、斜杠命令、进度卡、widget、theme、反应
- 能力：MCP、技能、技能工坊、自学习、目标、循环检测、轨迹、lobster
- 其它：ACP agents、秘密、思考级别、工具搜索

循环笔记里的死循环检测、压缩和记忆索引，是这些工具在跑起来之后的约束，不是工具目录本身。

## 目录怎么分

`src/agents/embedded-agent-runner` 是内置尝试循环、模型选择、压缩和 transcript。`src/agents/sessions` 是会话持久化、资源发现、提示模板和技能。`packages/agent-core` 是可复用的循环、消息和会话合同。`src/agents/harness` 是 harness 注册和选择。`src/llm` 是提供商传输。`src/gateway` 是协议和渠道。`src/channels`、`src/cron`、`src/plugins`、`src/plugin-sdk`、`src/memory-host-sdk`、`src/context-engine`、`src/mcp`、`src/nodes` 对应上面各层。插件走 `openclaw/plugin-sdk/*`，不直接 import `src/**`。

资源包在 `package.json` 的 `openclaw` 字段里声明 `extensions`、`skills`、`prompts`、`themes`。没写的类型退回约定目录。

## 记忆和梦境

工作区 Markdown 是源，SQLite 是索引，压缩摘要是会话层。三者不要混成一件事。压缩前的 memory flush 是一次静默回合，把要留下的事实写进记忆文件，这段维护记录不进后续用户轮。`docs/concepts/dreaming.md` 是另一条离线整理路径，和当轮 `memory_search` 分开。引用模式和来源等级见循环笔记。
