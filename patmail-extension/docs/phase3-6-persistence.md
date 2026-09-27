# Phase 3.6 查询快照持久化

## 写入结果

查询会话的持久化结果只有三种：

- `PERSISTED`：IndexedDB 事务 `oncomplete`
- `MEMORY_ONLY`：当前环境没有可用的 IndexedDB，只留在本次进程
- `FAILED`：打开失败、事务 abort 或 `QuotaExceededError` 一类写入失败

失败时不会把这次快照留在可恢复存储里。内存里可以暂时使用，但 `persistence` 不是 `PERSISTED`。`dropQuerySessionMemory()` 清掉热缓存和已标记的持久副本后，失败的快照不能恢复。

可恢复副本只在事务成功之后写入。Service Worker 重启后，只从 IndexedDB 读回 `PERSISTED` 的会话。

## 账号绑定

`forward` 在发出 `GetSearchFiles` 之前冻结：

- `easyOrigin`
- `operatorId`
- `easyTabId`
- `connectionVersion`

响应返回后先核对这份快照，再写入查询会话，写完后再核对一次。任一时刻账号或连接已经变化，结果丢弃，不写入新账号，也不把旧响应交回当前页面。

## 测试

单元测试覆盖了事务失败后的重启丢失，以及独立磁盘写入成功后清掉内存仍能恢复。

完整页面 E2E 使用扩展自己的 IndexedDB。它覆盖查询、跨页选择、字段重建、保存和刷新恢复。没有把 Fixture 当成真实 EASY 会话。
