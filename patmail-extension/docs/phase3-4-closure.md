# Phase 3.4 收口

Phase 3.4 留下的缺口由 Phase 3.5 的源码修改关闭。本文件只记录这些缺口和对应修复，不把 3.4 报告里的测试次数当作本轮结果。

## 仍开放的问题

- 文件查询快照按 `origin + operatorId` 只保留最后一次结果。翻页后，前一页的来源证明消失。
- 查询指纹来自返回的文件 ID 集合，不是查询条件。
- 来源核对只看文件 ID 是否在集合中，不核对名称、客户和描述。
- `task.fileSource` 可以为 `SEARCH_RESPONSE_OBSERVED`，同时 `verifiedSelection[].verification` 仍是 `FILE_SOURCE_UNVERIFIED`。
- 查询快照只在内存 Map 中。Service Worker 重启后无法恢复，也没有过期。
- `TaskStore.save` 遇到受保护任务时直接返回。调用方分不清写入成功和被保护跳过。
- `refreshStaleTasks` 可能把没有落盘的更新计入成功次数。
- 已有 `UNKNOWN` 且 `requestSent=true` 的任务，规则变化时可能被改写成 `STALE`，执行证据被盖掉。
- 发文规则已经保存，但旧任务重新核验失败时，调用方得不到分开的回执。

## 3.5 如何关闭

- 同一业务查询的每一页进入同一个 `FileQuerySession`。会话按 origin、操作者、EASY 标签页、连接版本和查询指纹隔离。
- 查询指纹改为规范化查询条件的 SHA-256。分页不进入指纹。
- Background 按文件 ID 从自己的快照重建名称、描述、客户和案件字段。页面传入值只用于发现不一致。
- 任务级来源由逐文件结果和同一个 `querySessionId` 计算。没有按 ID 回读，不标记 `FILE_READBACK_VERIFIED`。
- 查询会话写入 IndexedDB `patmail-file-query-sessions`，30 分钟过期。内存清空后可以恢复；存储清空或过期后降为未核验。
- `save` 返回 `TaskSaveResult`。受保护写入返回 `PROTECTED_EVIDENCE`，不再静默成功。
- `refreshStaleTasks` 只把原子写入成功计入 `updatedCount`。
- 受保护的 `UNKNOWN` 保持原状态和执行证据，并设置 `needsRevalidation`。
- 规则保存返回 `rulesSaved`、`tasksRevalidated`、`pendingRevalidation`。核验失败时规则仍然保持已保存。

生产邮件写操作和生产流程写操作保持关闭。
