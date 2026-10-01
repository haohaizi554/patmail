> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.7 接口契约证据

日期：2026-09-26。目录在 `src/automation/contract-evidence.ts`。

证据来源分为：已捕获响应、已捕获请求、页面脚本、Mock、未核对。502 不是成功。Mock 节点不能代替真实候选人。

| Call | 方法 | 响应已捕获 | 状态 | 说明 |
|---|---|---|---|---|
| `GetFlowInfo` | POST `Common.ashx` | 是 | verified | `Result` 是对象。只读。 |
| `GetFlowHistory` | POST `Common.ashx` | 是 | verified | `Result` 是历史，`flow_activity` 是当前活动。 |
| `GetUrgencyList` | POST `Common.ashx` | 是 | verified | `Result=false` 且 `Status=true` 仍可读列表。 |
| `GetFlowLastStatus` | POST `Common.ashx` | 是 | verified | 比较 `update_time_ss`。`status=-1` 且没有 last_status 视为一致。 |
| `GetFlowSubmit` | POST `Common.ashx` | 否 | pending | 已有 HAR 响应长度为 0，出现过 502。节点字段来自页面脚本。 |
| `MailCustomer` | POST `Notice.ashx` | 否 | pending | 请求字段已核对。响应正文未保存。单个来文的 `mailstyle` 未知。 |
| `SaveMailInfo` | POST `Mail.ashx` | 否 | pending | 字段名来自页面脚本。`customer_id` 只用快照 GUID。必须回读。 |
| `SaveMailRalteCaseFile` | POST `Mail.ashx` | 否 | pending | HAR 中 `file_ids` 为空。格式未核对时保持 `BINDING_BLOCKED`。 |
| `FlowSubmit` | POST `Common.ashx` | 否 | pending | 参数名来自页面脚本。不在传输白名单。生产路径不调用。 |
| `EndEmailFlowd` | POST `Mail.ashx` | 否 | pending | 字段和响应都未捕获。它不是审核通过，也不是邮件发送。 |

流程提交、流程审核、结束流程、邮件实际发送是四件不同的事。没有发明 `ApproveWorkflow` 参数。

本阶段没有在正式客户记录上补写请求。真实 EASY 只读对照和写接口捕获都还没有做。诊断入口在授权环境里可以只读调用已有白名单接口，这次验收没有连接真实 EASY。
