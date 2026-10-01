> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 只读接口契约

`readonlyContract` 按接口选择已经在业务服务里核对过的参数。缺参返回 `blocked`。请求字段还不能从当前上下文凑齐时返回 `pending`，文案带 `CONTRACT_PENDING`。这两种都不会 `post`。

| 接口 | 请求 |
| --- | --- |
| GetUserModel | `Call`、`log_pagename` |
| IPGetBasicData / GetFlowdirection | `Call`、`log_pagename=FileSearch.aspx` |
| LoadMailType | `Call`、`log_pagename=FileSearchMail.aspx` |
| LoadFileTypeByCaseType | `case_type`（不是 `case_type_id`）、`official`、`file_type`、`log_pagename` |
| GetMailInfo | `mail_id`、`log_pagename=mail.aspx` |
| GetMailFile / GetMailCase | `listParams` |
| GetFlowInfo | `flowInfoParams`：`obj_id`、`flow_type`、`flow_sub_type`、`log_pagename` |
| GetFlowHistory | `obj_id`、`log_pagename` |
| GetUrgencyList | `urgencyParams` |
| GetFlowLastStatus | `obj_id`、`flow_type` |
| GetSearchFiles、GetMailRule、GetCustomerContact、GetSignature、GetFlowSubmit | `CONTRACT_PENDING`，不发猜测请求 |

`extractReadonlyEvidence` 只提取响应里已经出现的字段，例如 GetMailInfo 的 `mail_id` / `customer_id` / `mail_type`，GetFlowInfo 的 `flow_id`、`cur_node_id`、`node_code`、`status`、`current_user_id`、`update_time_ss`，LoadFileTypeByCaseType 的 `FileType` 数量，GetSearchFiles 的 `TableRowsCount`。

验收结果：

- HTTP 200 且 `ClientInfo.Status=false`、`IsLogin=false` 或登录 HTML：`FAIL`，等级 `RESPONSE_OBSERVED`。原因写明业务状态未通过。
- 502/503：`FAIL`，等级 `REQUEST_OBSERVED`。
- Mock：`BLOCKED`，不能作为现场证据。
- 无对照字段时，GetUserModel 在操作员 GUID 存在且业务状态未失败时为 `PASS`，原因是「只读响应结构通过」，`matchedWithUi` 为 false，等级 `RESPONSE_OBSERVED`。
- 对照字段一致才是 `UI_COMPARED`，原因是「与原网站 UI 对照通过」。

页面同时展示结果、原因、是否对照过原网页，以及证据等级。
