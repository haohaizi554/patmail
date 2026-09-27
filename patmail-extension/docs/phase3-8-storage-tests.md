# Phase 3.8 存储测试

没有 IndexedDB 时，`defaultPut()` 返回不可用，会话记为 `MEMORY_ONLY`。清掉当前进程内存后，这份记录不能恢复，也不能继续当作可信来源。生产代码不再用内存 Map 冒充 `PERSISTED`。

旧记录缺少 `persistence` 时，`normalize()` 记为 `UNKNOWN`，不会补成 `PERSISTED`。从磁盘读入时恢复状态仍是待重新核验。

单元测试里的可提交磁盘适配器只用于协议：提交成功、更新失败、删除失败。它不是浏览器 IndexedDB。浏览器 E2E 打开扩展自己的 `patmail-file-query-sessions`，确认记录条数大于 0，然后关闭 Service Worker。恢复后的任务来源是 `FILE_SOURCE_UNVERIFIED`，历史观察和 `RECOVERED_PENDING_REVALIDATION` 都在。不能靠清空一个 Map 再读另一个 Map 来宣称 MV3 持久化已验证。
