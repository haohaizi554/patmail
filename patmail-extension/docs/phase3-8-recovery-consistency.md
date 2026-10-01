> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.8 恢复一致性

## 调用链

`GetSearchFiles` 进入 `observeSearchPage`。`persist()` 先写当前版本，成功后这一进程的内存标记为 `CURRENT`。写失败时新快照只留在内存，并调用 `delete()`。`delete()` 返回 `DELETED`、`NOT_FOUND` 或 `FAILED`。事务 abort、error 或数据库打不开都是 `FAILED`。删除失败时会话记下“磁盘上的旧查询记录未能删除，不能视为已撤销。”不会显示已经撤销。

Service Worker 重启后，`readSession()` 从 IndexedDB 读到的记录一律变成 `RECOVERED_PENDING_REVALIDATION`。磁盘里有记录，只说明它是历史观察。它不自动成为当前可信来源，也不能继续翻页。`recordVersion` 和 `lastObservedAt` 保留在记录上。更新失败时，磁盘里的旧版本号不会被当成这一进程里更新后的新版本。

`resolveSelectedFiles()` 只有 `recoveryState = CURRENT` 且持久化状态不是 `UNKNOWN`、页面证据仍有效、字段一致时，才给出 `SEARCH_RESPONSE_OBSERVED`。恢复出来的文件保留 `historicalObservation`、原来的 `fetchedAt` 和证据失效时间，验证级别是 `FILE_SOURCE_UNVERIFIED`。

当前服务端状态不能从磁盘单独确认。要重新获得当前来源，需要在这一进程里重新查询。

## 复现

修改前：第一页保存文件 A，同一页更新为只有文件 B 时 `put()` 和 `delete()` 都失败，清掉内存后再读磁盘，文件 A 重新得到 `SEARCH_RESPONSE_OBSERVED`。

修改后：文件 A 的验证级别是 `FILE_SOURCE_UNVERIFIED`，`historicalObservation` 为 true，`recoveryState` 为 `RECOVERED_PENDING_REVALIDATION`。磁盘记录仍是版本 1，内存中的失败更新是版本 2。
