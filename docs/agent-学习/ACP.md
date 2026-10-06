# ACP

ACP 是编辑器用来驱动 Hermes 的一条 stdio JSON-RPC。VS Code、Zed、JetBrains 走这条协议。stdout 只给协议帧。人能读的日志在 stderr。它包的是同一个同步 `AIAgent`，不是另一套循环。

OpenClaw 也有 ACP 运行时和 ACPX 会话，权限和沙箱按那条 harness 走。Claude Code 的 IDE 连接传的是选区和 diff，不是这条 Hermes 协议。

## Hermes 怎么接上

入口是 `hermes acp`、`hermes-acp` 或 `python -m acp_adapter`。先处理 `--version`、`--check`、`--setup`，再加载家目录里的 `.env`，然后 `acp.run_agent`。`HermesACPAgent` 负责初始化、认证、会话的新建、加载、恢复、分叉、列出和取消，以及一次 prompt 和会话内换模型。

每个活会话有 `session_id`、`agent`、`cwd`、`model`、`history` 和 `cancel_event`。管理器可以创建、取出、移除、分叉、列出和改工作目录，并且是线程安全的。

`new_session(cwd)` 建一份会话状态，再创建 `platform="acp"` 的 `AIAgent`。工具集和网关一样，从平台配置解析：默认的 acp 工具集，加上解析器允许的插件工具集，以及获准的 MCP，键是 `mcp-<服务器名>`。禁用的工具集仍生效。`task_id` 和会话 id 绑到这个 cwd 覆盖上，文件和终端相对编辑器工作区，而不是启动 Hermes 的那个目录。

一次 prompt 从 ACP 内容块里抽出文本，清掉取消事件，装上回调和批准桥，在线程池里跑 `AIAgent`，更新会话历史，再发出最终的 agent 消息块。agent 在工作线程，ACP 的 I/O 在主事件循环，桥用 `run_coroutine_threadsafe` 把回调送回去。

## 工具事件必须收口

每个 ACP 工具调用都要有终态。`tool.completed` 用自己的结果关上，成功或失败。`step_callback` 里的 `prev_tools` 只是某些运行时从不投影完成事件时的后备。回合结束时还开着的调用，包括被拒绝、被挡住或被打断的，在响应返回前标成 `failed`。

同一名字的多次调用按工具 id 做 FIFO，不是每个名字只记一个 id。并行或连续两次 `read_file` 时，完成事件要回到对应的那一次。没有这个队列，完成会贴到错误的调用上。

渲染上，`patch` 和 `write_file` 变成文件 diff，`terminal` 变成命令文本，`read_file` 和 `search_files` 变成预览。大结果截成界面安全的文本块。思考回调在这条桥上目前是空的，推理从 `step_callback` 走。

## 批准和取消

危险终端命令变成 ACP 的权限请求。`allow_once` 对应 Hermes 的 `once`，`allow_always` 对应 `always`，拒绝对应 `deny`。超时和桥故障默认拒绝。

批准回调只在这次 prompt 期间装到终端工具上，结束之后恢复原来的回调。不能把某一个 ACP 会话的批准处理留在进程全局里。

`cancel` 设置会话的取消事件，并在 agent 支持时调用 `interrupt()`。prompt 响应的 `stop_reason` 为 `cancelled`。

提供商拒绝、不可重试的错误、重试用尽，或在任何回复之前被打断，核心循环会写一条 Hermes 自己的助手行，说明这次请求没有处理完。耐久转录不能停在一条还开着的用户消息上，否则下一次 prompt 会并进失败的那次请求再重放。上下文溢出例外：修复方式是轮换会话，不是再补一行。

`fork_session` 把消息历史深拷进一个新的活会话。对话还在，会话 id 和 cwd 是新的。

## 认证

ACP 没有自己的凭据库。它用 Hermes 的运行时解析，所以编辑器里广告和使用的是当前配置的提供商和密钥。它始终广告一种终端设置方法 `hermes-setup`，参数 `--setup`，让第一次使用的客户端先打开 Hermes 的交互式模型配置，再开始普通会话。

解析顺序仍是显式参数、配置文件里保存的模型、环境变量、提供商默认。编辑器不会因为自己的环境变量悄悄换掉用户在 `hermes model` 里点过的端点。

## 这条表面上没有的东西

ACP 目前不实现 `/goal`。聊天里的站立目标和质量门不到编辑器这条协议上。看板、cron 和消息网关仍是各自的入口。ACP 会话死在编辑器断开时的方式和网关不同：网关是长进程，ACP 是这条 stdio 连接的生命周期。

profile 隔离仍然有效。编辑器会话用的家目录是启动它的那个 Hermes home。多 profile 的秘密不会因为编辑器连上来就改读另一个 profile 的 `.env`，除非这次进程就是按那个 profile 启动的。

## OpenClaw 和 Claude Code

OpenClaw 的 ACP 会话没有交互终端。支持的表单和 URL 仍可以在渠道回合里变成 Gateway 问题，那和命令批准不是同一条。ACPX 的 harness 权限在插件配置里，和 `tools.exec.mode` 并列。原生运行时的「仅此聊天继续」可以把沙箱豁免和完全访问绑在这一次聊天上，不改全局设置。重置或换运行时会清掉这份同意，分叉不继承。角色要求的沙箱仍然强制。

Claude Code 把 IDE 的选区、打开的 diff 和连接状态送进界面钩子。工具执行仍走 `canUseTool` 和本机 Bash。它不把 Hermes 的 `once` / `always` / `deny` 映射搬过去，也没有一份 stdio 上的 `HermesACPAgent`。
