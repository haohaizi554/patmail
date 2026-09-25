# Phase 2.5 状态机

日期：2026-09-26。实现在 `src/mail/easy/state.ts`。非法事件不会改状态。

```text
PREVIEW_READY
  → CONFIRM_REQUIRED
  → CREATING
  → CREATED
  → LOADING_MAIL
  → MAIL_LOADED
  → SAVE_CONFIRM_REQUIRED
  → SAVING
  → SAVED
  → BINDING_FILES
  → VERIFYING
  → COMPLETED
```

旁路：

| 从 | 事件 | 到 |
|---|---|---|
| CREATING | 没有 `objid`、超时或响应无法解析 | UNKNOWN |
| CREATING | 请求发出前被拒绝 | FAILED |
| LOADING_MAIL | 读取失败 | FAILED，保留 mail_id |
| SAVING | `ClientInfo.Status=false` | FAILED，不关联文件 |
| SAVING | 超时或响应无法解析 | UNKNOWN，不关联文件 |
| BINDING_FILES | 关联请求发出前失败 | PARTIAL_FAILURE |
| VERIFYING | 重新读取的文件不一致或读取失败 | PARTIAL_FAILURE |

`SAVED` 在 `file_ids` 格式未核对时停住，不进入 `BINDING_FILES`。

`UNKNOWN`、`PARTIAL_FAILURE` 和已有 `mail_id` 的记录会挡住同一预览的再次创建。不会删除邮件，也不会自动回滚。面板上的「重新读取邮件」只调用只读接口，不改变未知状态，也不再发创建请求。

执行记录键是 `patmail.mail.exec.v1:{origin}:{userId}`。没有用户 GUID 时不写入。记录含 executionId、用户、客户配置、文件 ID、发文类型、规则版本、指纹、阶段、mail_id 和最后错误。
