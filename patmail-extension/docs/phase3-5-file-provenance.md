> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.5 文件来源

## 事实来源

`resolveSelectedFiles` 用文件 ID 读取 Background 自己的查询快照。页面提交的 `SelectedPatentFile` 不是业务事实。

从快照写回的字段限于当前 `PatentFile` 已有内容：

- `fileId`
- `fileName`
- `fileDescription`
- `customerName`
- `caseId`
- `caseVolume`
- `applicationNo`

没有从接口响应中发明 `fileDescriptionId` 或 EASY `customerId`。

本地客户绑定单独保留：`customerProfileId` 和 `customerBinding`。本地配置名称不会改写快照里的 EASY `customerName`。

页面非空字段和快照不一致时，记录 `FILE_FIELD_MISMATCH`，业务字段按快照重建。若任务不是受保护的 `UNKNOWN`，状态改为 `BLOCKED`。

## 来源等级

- `FILE_SOURCE_UNVERIFIED`：没有可用的当前查询会话，或同一文件在多个不一致的观测里出现。
- `SEARCH_RESPONSE_OBSERVED`：该文件出现在指定查询会话的真实查询响应中。
- `FILE_READBACK_VERIFIED`：本阶段不产生。没有独立的按 ID 回读接口，不能把查询响应升级成回读。

`SEARCH_RESPONSE_OBSERVED` 只证明文件出现在该次查询响应里。它不等于按 ID 回读，也不等于可以执行生产写操作。

## 任务级来源

每一份文件有自己的 `verification` 和 `querySessionId`。

任务级 `fileSource` 为 `SEARCH_RESPONSE_OBSERVED`，必须同时满足：

- 每份文件都是 `SEARCH_RESPONSE_OBSERVED`
- 全部文件属于同一个非空 `querySessionId`

任一文件未核验，或文件来自不同查询会话，任务级来源为 `FILE_SOURCE_UNVERIFIED`。最低可信等级决定任务不能被标成全部可信。

## 生命周期

采用持久化方案：

- 热缓存：当前 Service Worker 内存。
- 持久副本：IndexedDB `patmail-file-query-sessions` / `sessions`。
- 有效期：30 分钟，按 `expiresAt`。

`dropQuerySessionMemory()` 只清热缓存。随后读取会从持久副本恢复。`clearQuerySessionStore()` 或会话过期后，来源降为 `FILE_SOURCE_UNVERIFIED`。不能因为任务记录还在，就把重启前的内存快照继续当成有效证明。
