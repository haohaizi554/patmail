# Phase 3.9 证据聚合

`aggregatePersistence()` 不再滤掉缺失的 `persistence`。只有每一份选中文件都明确是 `PERSISTED`，任务整体才是 `PERSISTED`。任一文件缺失、`UNKNOWN`、`FAILED` 或 `MEMORY_ONLY`，整体都不是 `PERSISTED`。

`evaluateTaskEvidence()` 的时间判断同样覆盖全部需要来源的文件。只有每份文件都有可解析且未过期的 `evidenceExpiresAt`，结果才是 `FRESH`。缺时间或时间无法解析时是 `UNKNOWN`，并要求重新核验。其中一份已过期则是 `EXPIRED`。没有 `verifiedSelection` 的旧任务是 `UNKNOWN`，不会被写成可执行的 `FRESH`。

`RESTORABLE` 只表示历史记录可以从磁盘读回。恢复状态仍是 `RECOVERED_PENDING_REVALIDATION` 时，当前信任保持关闭。
