# Phase 2.8 持久化

日期：2026-09-26。

## 任务业务层

`AutomationTaskService` 提供 `createTask`、`listTasks`、`getTask`、`saveTask`、`validateTask`、`archiveTask`、`recoverTask`。

生成计划时先做规则校验，再保存快照。`createTask` 在 `save` 抛错或列表里找不到该编号时返回 `persisted: false`。面板只有保存成功才显示“已保存”。

打开任务管理时按当前 `location.origin` 和用户读取任务，经 `readStoredTasks` 做结构校验。不能通过结构校验的对象留在 `opaque`，不当成可执行任务。

## 任务列表

历史列表展示任务编号、创建时间、客户、文件数量、预计邮件数量、状态和最后核对时间。点击一项会按当前配置重新校验后打开。多客户显示各位客户名称。

## 归档

归档是显式操作。`isProtectedTask` 拒绝归档这些记录：

- 任务状态 `RUNNING`、`UNKNOWN`、`PARTIAL_FAILURE`
- 检查点已 `requestSent` 且未 `verified`
- 子任务状态 `UNKNOWN`、`RUNNING`、`PARTIAL_FAILURE`、`BINDING_BLOCKED`

创建新任务不会裁掉这些记录。IndexedDB 归档在同一次 `readwrite` 事务里读取、判断保护状态并写入。事务回调里不发网络请求。

`chrome.storage` 路径也不再使用 `slice(-40)` 裁剪任务或执行租约。更早的邮件执行日志和流程日志仍保留各自的 40 条上限，那两处不是本阶段的任务库。

## 执行所有者

同一 `origin + operatorId + taskFingerprint` 只能有一个未释放的所有者。租约包含 `executionId`、`owner`、`leaseVersion`、`updatedAt`、`requestSent`。

`markSent` 在同一事务里核对所有者和 `leaseVersion`，不一致则拒绝，调用方不能发请求。`leaseVersion` 在标记已发和恢复时递增。

`indexedTransactionStore` 使用数据库 `patmail-execution-ledger`，对象库 `state`，键 `leases`。一次 `readwrite` 事务内完成读取、冲突判断和写回。

Background 在 IndexedDB 不可用时拒绝领取，不退回到内存 Map。重启后 `recover` 把 `requestSent` 且仍为 `RUNNING` 的租约改成 `UNKNOWN`。该指纹不能再次领取去创建邮件。

## 检查点

`CheckpointService` 的 `prepare`、`markRequestSent`、`markResponseReceived`、`markVerified`、`markUnknown` 都按 `itemId + stage` 修改检查点。

写阶段在发出请求前必须先把 `requestSent` 落盘。落盘失败时返回落盘前的任务，原因是“检查点没有写入，请求不会发出。” 请求一旦标记已发，超时、页面关闭或 Service Worker 重启都不能把它当成未执行并自动重试创建。

## 原子性边界

IndexedDB 事务保证的是本机这一份执行记录的互斥。它不提供 EASY 服务端的 exactly-once。没有服务端幂等契约时，写请求结果未知只能只读核验，不能自动重试 `MailCustomer`。

`ExecutionCoordinator` 仍保留，用来证明延迟的 `chrome.storage` 读改写可以让两个标签页都领取成功。因此 `CROSS_TAB_WRITE_EXCLUSION_PROVEN` 继续为 false。Background 的新领取路径使用账本，不再构造这个协调器。
