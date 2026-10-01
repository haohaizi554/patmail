> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.7 收口

Phase 3.7 的查询会话、页面证据时间和身份门禁仍然有效。Phase 3.8 修正了三个已经在源码里复现的缺口：

- 查询快照更新失败后，`delete()` 即使事务失败也会结束。磁盘上的旧记录会在 Service Worker 重启后重新变成 `SEARCH_RESPONSE_OBSERVED`。
- 任务上的 `evidenceExpiresAt` 只在创建时计算。过期后 `evidenceRestorable` 仍表示证据曾经保存，不表示现在仍然有效。
- `pack:source` 白名单包不含私钥，但普通工程压缩包仍可能带上 `dist.pem`。`.gitignore` 不能阻止手工打包。

没有 IndexedDB 时，内存 Map 不再被记成 `PERSISTED`。生产邮件写开关和生产流程写开关保持关闭。
