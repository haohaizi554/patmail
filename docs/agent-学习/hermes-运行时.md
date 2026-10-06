# Hermes 运行时

循环、闸门、预算和记忆钩子见 [hermes.md](hermes.md)。这篇写入口、提示词三层、工具注册、会话库和网关。材料来自 `website/docs/developer-guide/` 里的 architecture、agent-loop、prompt-assembly、tools-runtime、session-storage、gateway-internals。

## 一个核心，五类入口

`AIAgent` 同时服务于：

- CLI：`cli.py`，交互在 `hermes_cli/` 的 mixin 里
- 消息网关：`gateway/run.py` 的 `GatewayRunner`
- ACP：`acp_adapter/`，给 VS Code、Zed、JetBrains 的 stdio JSON-RPC
- 批跑：`batch_runner.py`，把会话收成训练用轨迹
- 作为库被直接调用

CLI 的路径是 `HermesCLI.process_input` → `run_conversation` → 组装提示词 → 解析提供商 → 按 API 模式调用 → 有工具就分发 → 正文落进 `SessionDB`。

网关的路径是平台适配器 `on_message` → `GatewayRunner._handle_message` → 授权 → 解析会话键 → 带历史创建 `AIAgent` → 跑完从适配器送回。

Cron 每次新建一个没有历史的 `AIAgent`，把挂上的技能当上下文注入，跑完投递到目标平台，再更新 `jobs.json` 里的下次时间。它不是 shell 定时任务。

平台差异留在入口。循环里不出现「现在是 Telegram 还是终端」这种分叉，除了那些明确走用户消息通道的表面提示。

## 三种 API 模式

内部消息始终是 OpenAI 形态：`system`、`user`、`assistant`（可带 `tool_calls`）、`tool`。推理内容放在 `assistant_msg["reasoning"]`。发出去之前再转换。

| 模式 | 对象 | 客户端 |
|---|---|---|
| `chat_completions` | OpenRouter、自建和大多数兼容端点 | `openai.OpenAI` |
| `codex_responses` | OpenAI Codex / Responses | 同一客户端，Responses 条目 |
| `anthropic_messages` | Anthropic Messages | `anthropic_adapter.py` |

解析顺序：构造参数里的 `api_mode`，然后提供商检测，然后 base URL 启发，默认 `chat_completions`。模式决定消息格式、工具调用形状、流式和缓存，不决定循环阶段。

角色必须交替。系统消息之后是 User、Assistant 交替。工具阶段是带 `tool_calls` 的 Assistant，后面可以连续多条 Tool，然后再一个 Assistant。不能有两条 Assistant 或两条 User 挨着。提供商会拒绝坏序列。发出前会修复合并。`/steer` 是唯一允许在工具结果后面再插一条 User 的情况。

API 调用放在后台线程，主线程等响应、中断或超时。用户新消息、`/stop` 或信号到来时，丢掉这一次 HTTP 响应，不把半截内容写进历史。

## 提示词三层

缓存的系统提示和每次请求临时加上的层是分开的。临时层包括预算警告和上下文压力，不写回缓存正文。

缓存正文按 `agent/system_prompt.py` 的顺序拼接：

1. **stable**：身份（`SOUL.md` 或内置身份）、工具和模型指引、编码操作说明。技能索引也在这一档。
2. **context**：调用方传入的 system message、项目文件（`.hermes.md`、`AGENTS.md`、`CLAUDE.md`、`.cursorrules`），然后才是跟工作区有关的 git 快照、操作者说明和平台提示。项目文件放在工作区快照前面，这样同一项目的不同 worktree 能共用更长的前缀。
3. **volatile**：内置记忆快照 `MEMORY.md`、用户档案 `USER.md`、外部记忆插件的说明块、时间戳和会话、模型与提供商一行，最后是运行环境（主机、家目录、当前工作目录）。

`skip_context_files`（子代理会设）时不读 `SOUL.md`，改用内置身份。表面从桌面切到 TUI 时，已存的系统提示字节不动，当前表面的说明作为一次性用户消息送出（`agent/surface_switch.py`）。

工具指引里把记忆收窄：跨任务都成立的事实才进记忆；任务步骤、坑和偏好进技能。怀疑过去对话里有相关内容时，先 `session_search`，不要让用户重说。

## 工具怎么注册

`tools/registry.py` 没有上游依赖。每个工具文件在 import 时调用 `registry.register`，登记名字、所属 toolset、给模型看的 schema、处理函数、可选的 `check_fn`、需要的环境变量、是否异步。`schema["description"]` 才是模型看见的说明。单独的 `description=` 参数只给注册表元数据，不会自动补进 schema。

`discover_builtin_tools` 用 AST 扫描 `tools/*.py`，只导入顶层有 `registry.register()` 的模块。写在函数里面的注册不会被扫到，所以辅助模块不会被误导入。可选工具缺依赖时记日志，不挡住其它工具。然后才发现 MCP 工具和插件工具。

同名工具若来自另一个 toolset，注册会被拒绝，除非 `override=True`。插件要覆盖内置工具，还得在配置里把 `plugins.entries.<id>.allow_tool_override` 打开。

`check_fn` 返回假或抛错，这个工具就不进本轮 schema。同一轮里相同的 `check_fn` 只跑一次。大约 70 个工具，约 28 个 toolset。终端有 7 个后端：本机、Docker、SSH、Daytona、Modal、Singularity、Vercel Sandbox。浏览器和网页各自还有多套后端，门面在 `browser_tool.py` 和 `web_tools.py`。

一次模型返回里如果只有一个工具，就在主线程执行。多个工具用线程池并发，结果仍按原来的调用顺序写回。交互工具（例如 `clarify`）强制串行。执行前走插件 `pre_tool_call`，再经 `tools/approval.py` 看是不是危险命令，危险则等用户。执行后走 `post_tool_call`。

和循环策略相关的工具不进这张注册表的第一跳，而在 `agent/inline_tool_executors.py`：todo、memory 等先被 agent 自己截住。顺序见循环笔记。

`tools/` 里按文件名还能看出这些族，循环笔记没有展开：终端和进程注册表、文件读写与补丁、网页抓取、浏览器（CDP、云、Lightpanda、真实用户配置）、代码执行沙箱、MCP 的发现、传输、OAuth 和健康、技能中心和技能管理、图像视频语音、飞书和 Discord、看板、人机确认、委托、cron、记忆、会话搜索。

## 会话库

状态库是 `get_hermes_home() / "state.db"`，不是写死的 `~/.hermes/state.db`。解析顺序：上下文里的覆盖、`HERMES_HOME`、平台默认（Windows 在 `%LOCALAPPDATA%/hermes`）。命名 profile 是 `<根>/profiles/<名>/`，自带数据库、配置和日志。CLI 在 import 其余模块之前就应用 `--profile`。子进程如果丢掉 `HERMES_HOME`，会掉回默认 profile。改 `HOME` 不能用来选 profile。

这取代了早先每个会话一个 JSONL 的做法。库里有会话元数据、完整消息、模型配置，并用 FTS5 做全文检索。会话有父子谱系，压缩会换代。

原地压缩把旧行标成 `active=0`，保留下来的上下文插成 `active=1`。被保护的消息可以在两代里各有一份，内容和时间戳相同。不要把这些归档行当重复删掉。查「活着的历史」只看 `active=1`。历史看起来回退时，要同时核对 profile 和 session id。

会话中重建 agent（例如工具配置变更）必须保住原来的数据库句柄，并在构造时绑上那个 profile 的 home。准备新 agent 失败时，旧 agent 仍负责拆掉自己。对不上的 session id 返回找不到，不改配置。

测试若碰到真实默认根或真实 profile 的 `state.db`，会在打开前抛错。绕过开关只给确实要碰现场库的测试子进程，不能写进日常 shell。

## 网关

`GatewayRunner` 由 `gateway/run_*.py` 一组 mixin 拼成：启动、适配器、入站、回合、忙碌、目标、通知、关闭，加上斜杠命令处理。`session.py` 管持久化和会话键。`delivery.py` 管出站。`pairing.py` 管私聊配对。`channel_directory.py` 把聊天 id 映成 cron 投递用的名字。`mirror.py` 做跨会话镜像，给定 `send_message` 用。`status.py` 管 profile 级的令牌锁，保证一个 profile 只有一个网关进程。

内置和遗留适配器在 `gateway/platforms/`（Signal、API、webhook 等）。大多数平台是插件：`plugins/platforms/<name>/`，通常是 `adapter.py` 加 `plugin.yaml`。文档写的是 20 个以上的平台，架构页列举了 Telegram、Discord、Slack、WhatsApp、Matrix、Mattermost、邮件、短信、钉钉、飞书、企业微信、IRC、Line、Teams、Google Chat 等。

授权是允许名单加私聊配对。斜杠命令在网关里分发。cron 的 tick 和后台维护也挂在这个长进程上。

## 插件

三个发现来源：`~/.hermes/plugins/`、项目里的 `.hermes/plugins/`、pip entry points。插件通过上下文 API 登记工具、钩子和 CLI 命令。

记忆提供者和上下文引擎是两类单选插件，配置在 `memory.provider` 和对应的上下文引擎项。同时多个会让工具 schema 膨胀，也会抢写。内置记忆工具和外部提供者可以并存，外部的只能有一个。

## 设计上反复出现的选择

| 选择 | 落点 |
|---|---|
| 提示词稳定 | 对话中途不改系统提示。改模型这种显式用户动作除外 |
| 执行可见 | 每次工具调用都有回调。CLI 用转圈，网关用聊天消息 |
| 可打断 | 模型和工具都能在半路取消，半截结果不进历史 |
| 核心与平台分开 | 同一个 `AIAgent`，平台代码留在入口 |
| 松耦合 | MCP、插件、记忆、上下文引擎用注册表和 `check_fn`，缺了就不可用 |
| profile 隔离 | `hermes -p 名字` 得到单独的家目录、配置、记忆、会话和网关 PID |

轨迹是另一条产品线：把会话收成 ShareGPT 形式，给定后续训练，不参与在线回复。
