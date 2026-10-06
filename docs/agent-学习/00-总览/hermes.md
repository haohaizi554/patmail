# Hermes Agent（爱马仕）

公开入口是 `run_agent.py` 混入的 `TurnFacadeMixin.run_conversation`。它先拿会话租约 `admit_durable_turn_lease`，再调用 `agent/conversation_loop.py` 的 `run_conversation`，进入 `_run_conversation_turn`。`chat()` 只取返回字典里的 `final_response`。

## 相位

`_LoopState` 把一次迭代串起来。`_run_phase` 看 verdict 的 `continue`、`break` 或 `return`。

| 阶段 | 做什么 |
|---|---|
| `begin_iteration` / `prepare_iteration` | 中断、预算、steer、预算告警 |
| `assemble_api_request` / `run_preflight_gate` | 组请求，压缩和压力闸门 |
| `_run_api_retry_loop` | 调模型，校验和错误恢复 |
| `normalize_model_response` | 规范化助手消息 |
| `run_tool_round` | 有工具调用就校验、落库、执行，然后继续 |
| `finish_text_response` + `apply_stop_gates` | 无工具时收正文；闸门可以再推一轮 |
| `finalize_turn` | 环外收尾：预算文案、落盘、结果字典 |

退出条件：调用次数小于 `max_iterations` 且 `iteration_budget.remaining > 0`，或一次性的 `_budget_grace_call`；出现中断（含租约丢失）；无工具且闸门放行；预检超时、工具校验失败或持久化失败。

6 步助手值得学的是把「调模型、跑工具、再调」拆成可中断的相位，并用硬预算封顶。默认数百次迭代、跨进程租约和 MoA 对浏览器插件过重。

## 迭代预算

父代理 `max_iterations` 默认 500。子代理读 `delegation.max_iterations`，代码默认 250。各自一份 `IterationBudget`，不共用计数。`iteration_budget.py` 里写的子代理默认 50 已经过时。

`begin_iteration` 每次进入扣 1。退还发生在两种情况：本轮工具只有 `execute_code`，或预检、压缩没有打到提供商。`_budget_grace_call` 只用于 Codex 推理卡死后的 fallback，再跑一次带工具的迭代。常规触顶走出循环，`handle_max_iterations` 再发一次摘要；Codex 和 Anthropic 会去掉 tools。摘要失败才用固定文案。`_maybe_inject_run_budget_wrapup` 管的是墙钟 `run_budget_seconds`，不是迭代次数。

6 步用尽时，应再发一次无工具的收尾，固定文案只作摘要失败的兜底。

## 提示词稳定

中途改系统提示、换工具集、重载记忆或重建系统提示，都会弄脏前缀缓存。唯一允许改历史的是压缩。

| 中途插入的内容 | 落点 |
|---|---|
| 斜杠技能 | 用户消息，可带静态 scaffold 的缓存边界 |
| 子目录 `AGENTS.md` | 追加到工具结果，上限 3.2 万字符，保留头尾 |
| `/steer` | 独立的用户行，插在最新工具结果之后 |

循环中途禁止再塞合成的用户消息，steer 是唯一例外。上下文文件只在启动时从工作目录读一次，因为它们进系统提示。上限约 2 万字符，也可按窗口动态封顶。同角色连续出现会在发请求前合并；严格模板会返回 400。

插件若要缓存：`system_prompt_block()` 只放会话内不变的说明。每轮召回走 `prefetch()`，挂到当轮用户消息。

## 压缩

两层。网关会话卫生大约在上下文的 85%，进 agent 之前挡一道。Agent 的 `ContextCompressor` 默认大约 50%，小窗口会抬到至少 75%，部分 Codex 路线可以到 85%。

四步：先不调用模型，把旧工具结果剪成一行桩；再划出保护头尾和中间边界；然后用辅助模型 `call_llm(task="compression")` 写结构化摘要；最后拼成头、摘要、尾。原子的工具调用组要一起保护。

摘要失败会武装会话级冷却，大约 60 秒、300 秒、900 秒。卡住后可以走 `fallback_chain` 再试一次。再次卡住就改走确定性兜底摘要，经租约和围栏提交，不允许半提交。超时则这一轮不压缩，也不丢消息。

`micro_compaction.py` 的滚动微压缩默认关闭，因为每轮改写前缀会打断缓存。手动 `/compress` 走 `compress_now`。

只用原文摘录时，仍值得先做无模型剪枝，用阈值和冷却避免来回压，失败时不半提交。

## 记忆

两层：内置 `MemoryStore` 用 `memory` 工具写 `MEMORY.md` 和 `USER.md`；外部 `MemoryProvider` 同时只允许一个，避免工具 schema 膨胀和两个后端抢写。

启动时 `initialize`，静态说明进系统提示后整段冻结。每轮前 `prefetch`，琐碎提示和斜杠跳过，结果打进本轮用户消息的 `api_content`。外部预取大约 8 秒超时，超时丢的是检索，不是写入。轮中由模型调提供者工具。轮后只有完整且未中断才 `sync_turn`，并预热下一轮。压缩前 `on_pre_compress`：v2 检查点要求先把证据落库，失败则 fail-closed，保留未压缩原文。

定时任务代码已经是 `skip_memory=False` 加上 `platform="cron"`，经 `agent_context="cron"` 跳过自动写入，避免定时噪声进用户记忆。子代理同理。

「文号必须在上文出现过」最接近 `sync_turn` 使用的完整 transcript，里面包含工具结果，而且中断轮不写。内置侧只有软约束，没有硬校验。

## 技能与 /learn

`/learn` 由 `build_learn_prompt()` 拼成一回合用户提示，交给现有工具搜集材料，再用 `skill_manage` 落盘。没有单独的蒸馏器。大材料用瘦的 `SKILL.md` 加 `references/` 分章。

描述不超过 60 字，因为技能索引每次会话都加载，超出会被截成 57 字加省略号，路由就失效。系统提示只列 `name: description`。全文靠 `skill_view`，或斜杠命令把全文嵌进用户消息，不改系统提示。

策展器 `maybe_run_curator` 默认间隔 7 天、闲置至少 2 小时。先按活跃度把技能标成 stale 或归档，钉住的和被 cron 引用的跳过，从不物理删除。模型合并默认关闭。`/learn` 前台创建的技能一般不是策展对象。会话后的 `background_review` 可以另做补丁。

办事插件该学短描述路由和按需加载。单次推断、未验证的弯路不要自动写成技能。

## 停手闸门

模型给出正文后，`apply_stop_gates` 按这个顺序看：

1. verify-on-stop：开关默认关。本轮改过可运行代码，工作区验证状态不是 passed，且 nudge 少于 2 次，就再推一轮。纯文档（`.md`、`.txt`、LICENSE）不要求验证。
2. pre_verify：本轮有文件改动，已注册钩子返回了继续文案，nudge 默认少于 3 次。
3. kanban：看板工人这一会话还没调过终端板工具，nudge 少于 2 次。

命中时正文留下当候补，写入 `pending_verification_response`，清空 `final_response`，再追加一条合成的用户 nudge。预算用尽时 `turn_finalizer._resolve_budget_fallback` 用这份候补收尾。

办事助手可以照第三道闸写：扫本轮有没有调用该调用的创建工具；没有就追加「去调用工具，不要只叙述」，最多 2 次，并复用候补答复。

## 工具护栏

分发顺序：`validate_tool_calls`，然后 `before_call` 护栏，然后内联工具（`delegate_task` 除外），然后委派、上下文引擎、记忆管理器，最后 `handle_function_call` 和 `registry.dispatch`。

未知工具名回一条工具错误，并附上可用名单。全部无效满 3 次就 partial 停轮。坏 JSON 少于 3 次时不写入消息、重新请求；满 3 次写入工具错误。参数被截断则直接 partial，不执行。异常接住后写成工具结果，角色交替保持住，循环不崩。

护栏的 `before_call` 可以 block：同参数连败、幂等无进展、搜索和子代理次数上限。`after_call` 可以 warn，或在同工具连败、同参数同结果时 halt。`observe_call` 可以把重复结果收成引用。halt 之后停轮，并写助手说明。

办事助手已经会把错误回成工具消息。还缺的是同参数连败的硬停，以及全无效 3 次就停。

## 辅助模型

压缩、视觉、标题，以及审批、技能中心、策展、MoA、目标评判等，走 `call_llm(task=…)`。每个任务可以在 `auxiliary.<task>` 下单独指定提供商、模型和推理强度。`provider: auto` 时跟主模型。`session_search` 已经直接查库，不再调用辅助模型。策展读的是 `auxiliary.curator`，但是另起一个 AIAgent，不碰主会话缓存。

辅助调用只发 `pre_auxiliary_call` 和 `post_auxiliary_call`，不进主循环的 `pre/post_api_request`，避免侧任务被算进主对话的观测和计费。以后若要做摘要，用独立任务槽，结果以新的用户消息或工具结果注入。

## 子代理

`delegate_task` 在进程内再起一个 `AIAgent`。子代理迭代上限以配置为准，默认 250，和父代理的 500 不共用。父只看见 JSON 摘要，看不见子代理的中间工具链。`model_tools._last_resolved_tool_names` 是进程全局，子代理构造前要保存，cleanup 时恢复，否则父后续会读到子代理的工具名单。子代理跳过记忆和上下文文件，凭证从父继承。

单面板办事需要逐步可见、可绑定界面。子代理面向「并行隔离、只回摘要」，这里用不上。
