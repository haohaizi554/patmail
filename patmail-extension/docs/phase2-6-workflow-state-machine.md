> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.6 流程状态机

日期：2026-09-26。状态属于 `WorkflowExecutionRecord`，与邮件执行记录分开存储。键是 `origin + userId`，记录里再按 `mailId` 区分。不保存 Cookie、Authorization、密码或完整用户模型。

## 状态

`NOT_STARTED`、`READING`、`READY`、`SELECTING_NODE`、`SELECTING_REVIEWER`、`PREVIEW_READY`、`CONFIRM_REQUIRED`、`CHECKING_VERSION`、`SUBMITTING`、`SUBMITTED`、`VERIFYING`、`COMPLETED`、`STALE`、`UNKNOWN`、`FAILED`、`BLOCKED`。

正常 Mock 路径：

```text
READING → READY → PREVIEW_READY → CONFIRM_REQUIRED
  → CHECKING_VERSION → SUBMITTING → SUBMITTED → VERIFYING → COMPLETED
```

节点不唯一时进入 `SELECTING_NODE`。同名审核人需要 GUID 时进入 `SELECTING_REVIEWER`。身份不成立、没有流程、或生产提交条件不足时进入 `BLOCKED`。

## 版本

提交前重新读取 `GetFlowInfo` 和 `GetFlowLastStatus`。

- `status=-1` 且 `last_status` 为空：按起始状态继续。
- 两边都有 `update_time_ss` 且相同，当前节点也没变：进入提交。
- 时间或当前节点变了：`STALE`。下一节点和审核人清空，不能沿用旧计划。
- 版本无法比较：停止，不提交。

## 未知结果

进入 `SUBMITTING` 之前先把 `requestSent` 写入记录。之后没有明确的接受或拒绝，就进入 `UNKNOWN`。再次提交直接返回这条记录，不自动重试。可以重新读取 `GetFlowInfo` 和 `GetFlowHistory`，状态仍保持 `UNKNOWN`。

HTTP 200 本身不是提交成功。Mock 的接受结果也要等回读看到节点变化，才进入 `COMPLETED`，并标明不是 EASY 真实成功。

## 与邮件状态的关系

流程读取要求对应邮件已经是 `COMPLETED`。`BINDING_BLOCKED`、`PARTIAL_FAILURE` 和还在保存中的邮件不能进入流程。邮件保存成功但文件关联格式未核对时，邮件状态停在 `BINDING_BLOCKED`，保留 `mail_id`。

同一 `origin + userId + mailId` 的提交流程在一个存储实例内串行。已经发出或处于 `UNKNOWN`、`SUBMITTING`、`SUBMITTED`、`VERIFYING`、`COMPLETED` 的记录会挡住另一次提交。
