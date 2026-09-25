# Phase 2.6 缺陷收口

日期：2026-09-26。

## 结论

Phase 2.6 的四项 P0 已收口。已经发出写请求的记录不能靠重新规划解除防重复限制。

| 问题 | 处理 |
|---|---|
| 预览或确认后不能重新规划 | `PLAN_INVALIDATED`、`REPLAN_REQUESTED`、`PLAN_UPDATED`、`READ_REFRESHED` 把规划态送回 `READY`。修改节点、审核人、缓急或备注时先作废旧计划，再用新输入规划。 |
| 审核人列表合并了全部节点 | `reviewersForNode` 只返回当前 `nodeId` 的候选人。节点变化时清空 `reviewerId` 和本地计划。匹配仍只用 GUID。当前用户不在新节点时为 `BLOCKED`。 |
| 刷新只更新内存里的候选节点 | `refresh` 重新调用 `GetFlowInfo`、`GetFlowHistory`、可选节点和版本字段。`flow_id`、`cur_node_id` 或 `update_time_ss` 变化时旧计划作废。 |
| 刷新页面后内存详情丢失 | `restore` 按邮件 ID 找回持久化记录，只读重建 `WorkflowView`。`SUBMITTING` 且 `requestSent` 先进入 `UNKNOWN`，然后只重读，不提交。 |

## 工作流迁移

| 当前状态 | 可进入 | 说明 |
|---|---|---|
| `NOT_STARTED` | `READING` | 开始读取 |
| `READING` | `READY`、`FAILED` | 读取成功或失败 |
| `READY`、`SELECTING_NODE`、`SELECTING_REVIEWER` | 规划态，或经重新规划回到 `READY` | 规划失败进入 `BLOCKED` |
| `PREVIEW_READY` | `CONFIRM_REQUIRED`，或回到 `READY` | 确认前可以作废 |
| `CONFIRM_REQUIRED` | `CHECKING_VERSION`，或回到 `READY` | 请求尚未发出 |
| `CHECKING_VERSION` | `SUBMITTING`、`STALE`、`BLOCKED`，或在未发出请求时回到 `READY` | `VERSION_MATCH` 才把 `requestSent` 写成 true |
| `SUBMITTING` | `SUBMITTED`、`FAILED`、`UNKNOWN` | 没有重新规划出口 |
| `SUBMITTED` | `VERIFYING` | 只核验 |
| `VERIFYING` | `COMPLETED`、`FAILED` | 只核验 |
| `STALE`、`FAILED`、`BLOCKED` | `READY` | 仅当 `requestSent` 为 false |
| `UNKNOWN`、`COMPLETED` | 无 | 不能重试写请求 |

`canReplan` 在 `requestSent` 为 true 时直接返回 false。`UNKNOWN`、`SUBMITTING`、`SUBMITTED`、`VERIFYING`、`COMPLETED` 没有重新规划边。

页面崩溃停在 `VERIFYING` 时，恢复后状态保持 `VERIFYING`。这时请求已经发出，刷新只重读，不会再提交，也不会把失败显示成成功。

## 邮件迁移

邮件状态机与流程状态机分开。邮件的 `COMPLETED` 只表示 PatMail 侧核验完成，不表示流程已提交。

| 当前状态 | 可进入 |
|---|---|
| `PREVIEW_READY` | `CONFIRM_REQUIRED` |
| `CONFIRM_REQUIRED` | `CREATING` |
| `CREATING` | `CREATED`、`FAILED`、`UNKNOWN` |
| `CREATED` | `LOADING_MAIL` |
| `LOADING_MAIL` | `MAIL_LOADED`、`FAILED` |
| `MAIL_LOADED` | `SAVE_CONFIRM_REQUIRED` |
| `SAVE_CONFIRM_REQUIRED` | `SAVING`，差异变化时回到 `MAIL_LOADED` |
| `SAVING` | `SAVED`、`FAILED`、`UNKNOWN` |
| `SAVED` | `BINDING_FILES`、`BINDING_BLOCKED` |
| `BINDING_FILES` | `VERIFYING`、`PARTIAL_FAILURE` |
| `VERIFYING` | `COMPLETED`、`PARTIAL_FAILURE` |
| `COMPLETED`、`PARTIAL_FAILURE`、`BINDING_BLOCKED`、`UNKNOWN`、`FAILED` | 无 |

`UNKNOWN` 和 `requestSent` 会挡住同指纹的另一次创建。失败不会被写成成功。`BINDING_BLOCKED` 是终态，表示文件关联格式未核对，没有调用 `SaveMailRalteCaseFile`。

## 审计

- 非终态都有出口。写请求中断后的出口是 `UNKNOWN` 或保持已发出状态，不是自动重试。
- 非法事件不会改状态。`move` 在事件不合法时返回 null。
- 旧计划在节点、审核人、备注或流程版本变化后被清空。
- 执行记录在存储里。新的运行实例可以按邮件 ID 只读恢复。
