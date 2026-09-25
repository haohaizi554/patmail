# Phase 2.6 架构

日期：2026-09-26。

## Existing Architecture Audit

继续使用现有 `patmail-extension/`。没有新的 Vue 工程，没有第二套 API Runtime，也没有新的消息总线。

| 已有位置 | 本阶段的用法 |
|---|---|
| `src/api/transport.ts` | 只为只读流程 Call 增加白名单。`FlowSubmit` 和 `EndEmailFlowd` 不在白名单里 |
| `src/api/client.ts` | `EasyRuntime` 增加流程读取和预览。没有 `workflowGate` 选项，页面不能换上测试门禁 |
| `src/mail/easy/` | 仍是邮件状态机。本阶段补上差异摘要、选择集校验、同实例互斥和 `BINDING_BLOCKED` |
| `src/shared/message.ts` | 邮件消息改为选择集和差异摘要。流程消息只有读取、刷新和预览 |
| `src/floating/MailWorkspace.vue` | 邮件面板之后挂 `WorkflowPanel.vue`。只有邮件 `COMPLETED` 才能读取流程 |

新增 `src/workflow/`。它有自己的类型、契约、只读服务、节点解析、审核人解析、参数构建、状态机、计划和执行记录。流程状态不写入 `MailExecutionState`。两边用已经确认的 `mail_id` 关联。

## 三条状态

| 状态机 | 表示的事情 |
|---|---|
| `MailExecutionState` | 邮件是否创建、保存、关联并核对 |
| `WorkflowExecutionState` | 流程是否读取、预览、版本核对、Mock 提交和回读 |
| `ReviewPreview.state` | 当前用户是不是候选审核人。审核写接口保持 `PENDING` |

保存邮件不是提交流程。提交流程不是审核通过。审核通过也不是邮件已经发出。没有一个总的成功布尔值。

## 数据流

```text
已核对的 mail_id
  → GetFlowInfo / GetFlowHistory / GetUrgencyList
  → GetFlowSubmit（只读下一节点，响应正文未核对）
  → 用户选择节点和审核人
  → 提交计划
  → GetFlowInfo + GetFlowLastStatus
  → Mock 提交（生产路径到此停止）
  → 再次 GetFlowInfo
```

`versionToken` 只来自响应里的 `update_time_ss`。字段缺失时保持 `null`，不另造版本号。

## 写操作

`WORKFLOW_WRITES_ENABLED` 固定为 `false`。普通页面消息不能把它打开。生产 `EasyRuntime` 不接收 Mock 提交回调。测试里的 Mock 只在直接构造的 `WorkflowRuntime` 上运行，而且不走 `FlowSubmit` 网络请求。
