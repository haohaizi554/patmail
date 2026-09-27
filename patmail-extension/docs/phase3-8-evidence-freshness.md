# Phase 3.8 证据时间

`evaluateTaskEvidence(task, currentAccount, now)` 分开返回：

| 字段 | 含义 |
| --- | --- |
| `historicalObservation` | 曾经观察到查询结果 |
| `persistence` | 记录当时是否写入磁盘 |
| `freshness` | `FRESH`、`EXPIRED` 或 `UNKNOWN` |
| `recoverability` | 磁盘记录能否作为历史读回，不是当前是否可信 |
| `requiresRevalidation` | 当前不能当作可执行证据 |

`evidenceRestorable = true` 只表示证据曾经按 `PERSISTED` 保存。过期、恢复待核验、仅内存或保存失败都会要求重新核验。检查不修改 `fetchedAt`。

这些时机使用当前时间：打开任务、重新核对、Dry-run、`buildStagePlans()`、`validateTask()`。阶段计划不再只读创建时的 `identityGate`。证据过期时业务阶段显示“查询证据已过期，请重新查询。” `FILE_QUERY` 等只读诊断阶段仍可进入。写阶段继续全部关闭。

时间边界：T0 查询文件 A，T0+5 分钟生成任务，T0+35 分钟重新判断为 `EXPIRED`。同一文件若另一页仍在有效期内，解析仍使用那一页，不延长旧页。全部页面过期后，新的查询可以建立新的当前来源。系统时间越过 `evidenceExpiresAt` 即过期，时间回退到失效时间之前则仍按该时间戳判断。
