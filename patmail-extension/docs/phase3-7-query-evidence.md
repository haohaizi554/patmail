# Phase 3.7 查询证据

## 数据流

| 步骤 | 数据来源 | 验证级别 | 持久化 | 信任边界 |
| --- | --- | --- | --- | --- |
| `GetSearchFiles` | 当前浏览器里的 EASY 会话 | 响应可解析才进入结果 | 不在这一步保存 | 页面不能自己声明文件已观察 |
| `FileSearchResult` | 现有文件查询归一化 | 行内必须有 `fileId` 和 `fileName` | 尚未保存 | `querySessionId`、`sourceCode`、`sourceMessage` 是 PatMail 注解，不是 EASY 字段 |
| `observeSearchPage` | 这一次响应的一页 | 页码必须与请求一致 | 由后续 `persist` 决定 | 同一 `fileId` 字段不一致时标记冲突，不选第一条或最后一条作为可信行 |
| `FileQuerySession` | Background 发出的 `querySessionId` | `ACTIVE`、`STALE`、`CONFLICT`、`EXPIRED` | `PERSISTED`、`MEMORY_ONLY` 或 `FAILED` | 会话有效期取各页证据失效时间的最晚值，不延长旧页 |
| `resolveSelectedFiles` | 只读取请求上的那一个 `querySessionId` | 仍有效、字段一致且未冲突的页面才是 `SEARCH_RESPONSE_OBSERVED` | 逐文件记下该会话的持久化状态和证据失效时间 | 过期页、冲突页、错误账号、错误 continuation 都不授予可信来源 |
| `createTaskPlan` | 上面的重建结果 | `FILE_DATA_CONFLICT`、`MIXED_QUERY_SESSION`、字段不一致都会阻塞任务 | 任务保存查询来源、观察时间和持久化状态 | 冲突文件不进入可信计划 |
| `AutomationTask` | IndexedDB 中的任务 | `identityGate` 参与阶段计划 | 任务记录不等于来源记录仍可恢复 | `MEMORY_ONLY` 和 `FAILED` 的 `evidenceRestorable` 为 false |
| IndexedDB | `patmail-file-query-sessions` 与任务库 | 只有 `PERSISTED` 能在 Background 重启后读回 | 写入失败时热内存仍可预览，磁盘记录删除 | 来源丢失后不能再声称证据可恢复 |

不同页的查询响应不是同一次服务端事务。跨页集合没有事务级一致性。

## 冲突

`filesFromResult()` 在同一页发现同一 `fileId` 的业务字段不一致时设置 `conflict: true`。`indexFromPages()` 保留这个标志，并在跨页字段不一致时重新计算。冲突是当前页快照的结果：后一次完整页面如果不再有分歧，状态按当前页面重算，不永久保留历史冲突。

`FILE_DATA_CONFLICT` 的文件验证级别是 `FILE_SOURCE_UNVERIFIED`。查询列表仍可显示，来源状态单独显示“查询运行冲突。”

## 页面证据

每个 `FileSearchPageSnapshot` 有 `observedAt` 和 `evidenceExpiresAt`。有效期是该页观察时间之后 30 分钟。`resolveSelectedFiles()` 只使用仍未过期、且业务字段一致的页面。文件同时出现在多页时，可以使用仍有效的一致页面。

模拟时间：第一页在 T0 含文件 A，T0+25 分钟读取第二页含文件 B，T0+35 分钟选择 A。A 的第一页证据已经超过 30 分钟，即使会话容器尚未过期，A 也不是 `SEARCH_RESPONSE_OBSERVED`。B 仍可以使用第二页。
