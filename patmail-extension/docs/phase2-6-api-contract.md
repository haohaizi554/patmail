# Phase 2.6 接口契约

日期：2026-09-26。下面五类不能混用。

## 已确认的 HAR 请求

来源：`API/08-流程审批.md`，以及 `HAR/提交发文（要获取客户）`、`HAR/在发文审核中结束流程` 的说明。

| Call | Handler | 结论 |
|---|---|---|
| `GetFlowInfo` | `POST /AjaxServers/Common.ashx` | 请求已核对。`obj_id` 是邮件 ID，`flow_type` 在发文抓包里是 `CO`，`flow_sub_type` 为空 |
| `GetFlowHistory` | 同上 | 请求已核对。`log_pagename=mail.aspx` |
| `GetUrgencyList` | 同上 | 请求已核对。只有 `Call` 和 `log_pagename=IhgFlow.aspx` |
| `GetFlowSubmit` | 同上 | 请求字段来自当时的 `GetFlowInfo`。抓包响应长度为 0，正文没有保存 |
| `GetFlowLastStatus` | 同上 | 提交前读取。参数是 `obj_id` 和 `flow_type` |
| `FlowSubmit` | 同上 | 页面会组这些参数。这次没有调用，响应正文没有保存 |
| `EndEmailFlowd` | `Mail.ashx` | 邮件页结束流程会先读 `GetFlowInfo` 再调用它。没有执行，请求字段和响应都没有保存 |

`flow_type=CO` 只用于这次发文流程。读取函数把流程类型当作参数，不把 `CO` 写成所有业务的默认值。邮件面板调用时显式传入发文流程类型。

## 已确认的真实响应

这些字段来自已经核对过的只读响应，不是从 Call 名称推测的。

`GetFlowInfo` 的 `Result` 是对象。已记录：`obj_id`、`flow_id`、`cur_node_id`、`node_code`、`node_name_zh_cn`、`status`、`dept_id`、`cur_user_id`、`cn_name`、`urgency_id`、`user_list`、`update_time_ss`，以及文档列出的名称、跳过、并行和更新时间派生字段。`obj_id` 与当前邮件不一致时拒绝。

`GetFlowHistory` 的 `Result` 是历史数组。`flow_activity` 是另一个对象，表示当前活动节点。两者分开保存。

`GetUrgencyList` 使用 `UrgencyList`。字段是 `urgency_id`、`urgency_code`、`urgency_name`、`seq`。`ClientInfo.Result=false` 且 `Status=true` 仍然读取列表。`Status=false` 才当作拒绝。

`GetFlowLastStatus` 已确认的比较字段是 `last_status.update_time_ss`。`status=-1` 时允许 `last_status` 为空，并视为起始状态可继续。其余缺版本的情况保持未知，停止提交。

## 根据页面脚本得到的结构

`GetFlowSubmit` 的响应正文没有保存。`IhgFlow.js` 成功回调会读 `flow_type_name` 和 `Result[]`，节点上用到 `list_id`、`seq`、`next`、`node_id`、`node_code`、`node_name_zh_cn`、`allow_skip`、`user_type`、`user_list_id`、`user_list_name`、`user_list`、`need_all_audit`、`is_parallel`。

解析器按这个形状读取，但快照标记 `submitContract: 'unverified'`。不能把脚本字段当成已经核对的响应。

`FlowSubmit` 的参数名和 `f_status` 的计算来自页面脚本：下一节点代码 `END` 为 `5000`，`FIRST` 为 `0`，其他非空代码为 `1000`。`f_audit_type_id` 只接受 `submit` 或 `handover`。这些是参数来源，不是已捕获的成功响应。成功条件在脚本里是 `ClientInfo.Result=true`，本次没有响应样本。

`f_score`、`finishdate`、`pic_user` 和三个期限字段出现在脚本参数列表里，抓包没有留下值。构建器在没有明确来源时不填空，计划不能提交。

## Mock 推断

测试夹具按脚本形状放了节点数组，审核人用 `{ user_id, cn_name }` 数组。这是 Mock，不是生产响应。`user_list` 如果是带分隔符的字符串，解析结果是 `unknown`，不能选人。

Mock 提交回调返回 `accepted`、`rejected` 或 `unknown`。`accepted` 之后会再读流程，节点变化才进入 `COMPLETED`。完成视图会写明这不是 EASY 真实提交。

## 尚未验证的写接口

| 接口 | 处理 |
|---|---|
| `FlowSubmit` | 可以构建参数。不在传输白名单中。生产路径不调用 |
| `EndEmailFlowd` | 只保留“不能组参数”的结果。不发明字段，不调用 |
| 审核通过 | 没有独立的已核对写接口。不发明 `ApproveWorkflow`。结束流程也不当作通用审核接口 |

发文流程如果配置了自己的 handler，页面会把同一组参数交给那个 handler。该 handler 地址没有在本次抓包里确认，PatMail 不另选地址。
