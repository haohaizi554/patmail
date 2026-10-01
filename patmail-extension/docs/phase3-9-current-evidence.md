> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.9 当前来源

数据分成两层。

历史证据留在任务的 `verifiedSelection` 上：`fetchedAt`、当时的文件名称和描述、`querySessionId`、当时的验证级别。后续查询不会改写这些字段。

当前核验由 `evaluateCurrentTaskEvidence()` 读取 Background 里的查询运行。它不接受页面传入的 `CURRENT_VERIFIED`。读取任务详情、重新核对、生成阶段计划和规则保存后的任务重检都走这条路径。

逐文件结果是这些值之一：

`CURRENT_VERIFIED`、`QUERY_SUPERSEDED`、`FILE_REMOVED`、`FILE_FIELDS_CHANGED`、`EVIDENCE_EXPIRED`、`RECOVERED_PENDING_REVALIDATION`、`PERSISTENCE_UNAVAILABLE`、`ACCOUNT_MISMATCH`、`UNKNOWN`。

翻页增加 `recordVersion` 不会单独撤销上一页没变的文件。第一页重新查询后不再包含 A 时，即使任务上的失效时间还没到，A 的当前来源也是 `FILE_REMOVED`。磁盘恢复后的记录可以读回，`recoverability` 可以是 `RESTORABLE`，但 `currentTrust` 不是可信，必须重新查询。

尚未执行的任务在来源失效后进入 `STALE`，并记下 `CURRENT_EVIDENCE_INVALID`。已经是 `UNKNOWN`、检查点 `requestSent` 或已有 `easyMailId` 的任务保持原状态和检查点，只追加当前来源无效，不退回 `READY`。

阶段计划使用这次 Background 算出的当前证据。写阶段继续全部关闭。`FILE_QUERY` 等只读诊断阶段仍可进入。
