> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.5 任务持久化

## 保存结果

`IndexedTaskStore.save`、`SerialTaskStore.save`、`TaskRepository.save` 和 `MemoryTaskRepository.save` 都返回 `TaskSaveResult`：

- `ok: true` 时带上实际写入的任务和 `recordVersion`
- `ok: false` 时带上 `VERSION_CONFLICT`、`PROTECTED_EVIDENCE` 或 `INVALID_TRANSITION`

受保护任务不再在 `save` 里直接 `return`。调用方可以区分真正写入和被执行证据保护拒绝。

## 已有任务

已有记录的更新走 `updateTaskAtomically`：

1. 读取当前记录
2. 检查 `expectedVersion`
3. 校验状态转换
4. 保护执行证据
5. 写入并增加 `recordVersion`

IndexedDB 实现放在同一次 `readwrite` 事务里。`SerialTaskStore` 放在同一次串行回调里。`TaskRepository` 的队列只覆盖当前进程，不是跨进程事务。事务里不发送 HTTP。

新任务仍由 `createTaskPlan` 插入。正式页面的 `SAVE_TASK` 继续不能插入或改写完整任务。

## UNKNOWN 与重新核验

已有 `UNKNOWN`、`requestSent=true` 或只读任务，在规则或模板变化后保持 `UNKNOWN` 和原有执行证据，并设置 `needsRevalidation=true`。

不会把这类任务改写成 `STALE`。

`refreshStaleTasks` 返回：

- `updatedCount`：原子写入成功
- `unchangedCount`：状态、只读标记、重新核验标记和问题列表都没有变化
- `protectedCount`：`PROTECTED_EVIDENCE`
- `conflictCount`：`VERSION_CONFLICT`
- `errors`：单条更新抛出的错误

尝试更新但没有落盘时，不计入 `updatedCount`。

## 规则与核验分开

`saveRuleAccount` 先保存规则。随后的任务重新核验如果失败，规则保存不回滚。

返回值包含：

- `rulesSaved=true`
- `tasksRevalidated`
- `pendingRevalidation`
- `revalidation`

工作台提示为「发文规则已保存。旧任务重新核验没有完成，可以单独重试，不必再次保存规则。」再次提交旧版本仍会报「发文规则已被其他页面更新」。重新加载会再次核验任务，不需要重复保存同一条规则。
