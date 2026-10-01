> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.9 租约协议

日期：2026-09-26。

Background 是唯一的 Lease Authority。内容脚本通过这些消息操作租约：

`CLAIM_EXECUTION`、`MARK_EXECUTION_PREPARED`、`MARK_EXECUTION_SENT`、`MARK_EXECUTION_RESPONSE`、`MARK_EXECUTION_VERIFIED`、`COMPLETE_EXECUTION`、`RELEASE_EXECUTION`、`MARK_EXECUTION_UNKNOWN`、`RECOVER_EXECUTION`。

除领取时还没有执行编号外，后续消息都带 `operatorId`、`taskFingerprint`、`executionId`、`leaseVersion`。版本或所有者不一致时拒绝，并且不会发请求。

任务消息是 `LIST_TASKS`、`GET_TASK`、`SAVE_TASK`、`ARCHIVE_TASK`、`VALIDATE_TASK_METADATA`。未确认的用户得到空列表，保存被拒绝。

## 写请求顺序

```text
Claim
  → 任务检查点 PREPARED 落盘
  → MARK_EXECUTION_PREPARED
  → MARK_EXECUTION_SENT，并确认 leaseVersion 已增加
  → 任务检查点 requestSent 落盘
  → 才允许 fetch
  → MARK_EXECUTION_RESPONSE
  → 只读回读
  → MARK_EXECUTION_VERIFIED
  → COMPLETE
```

`PREPARED` 落盘失败时释放租约，不 fetch。`markSent` 失败时不 fetch。`requestSent` 检查点在发送标记之后如果写失败，租约进入 `UNKNOWN`，仍然不 fetch。

## 重启

`requestSent=false` 的 `CLAIMED` / `PREPARED` 在恢复时变成 `RELEASED`，因为按协议这时写请求还没有发出。

`requestSent=true` 且尚未核验完成的租约变成 `UNKNOWN`。同一指纹不能再领取去创建邮件。

`COMPLETED` 不再占住指纹。`UNKNOWN` 会占住，直到只读核对而不是自动重试。

IndexedDB 事务保证的是本机这一份账本。它不表示 EASY 服务端恰好执行一次。
