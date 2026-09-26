# Phase 3.3 收口

Phase 3.3 留下的缺口由 Phase 3.4 的源码修改关闭。本文件只记录这些缺口和对应修复，不把 3.3 报告里的测试次数当作本轮结果。

## 仍开放的问题

- `SAVE_TASK` 在顶层状态和指纹通过后，仍会插入新的 `taskId`。子任务 `COMPLETED` 和 `checkpoint.verified=true` 在 `requestSent=false` 时不会被拒绝。
- 覆盖检查是 `list` 之后再 `save`，不在同一个 IndexedDB 事务里。
- 模板摘要使用 `` `${key}=${value}` `` 再按换行拼接，值和键里的换行、等号会撞摘要。
- `buildQueryDependencies` 冻结全部客户。没有 `queryDependencies` 的旧任务会跳过模板比较并保持可执行。
- 已有客户可以不带 `expectedRevision` 覆盖。客户和模板保存没有同一账号的进程内队列。
- 所有修改共用 `mutationSerial`。后一个修改会使前一个回执不能提交。
- 文件来源固定为 `FILE_SOURCE_UNVERIFIED`。页面提交的文件列表没有和查询响应核对。

## 3.4 如何关闭

- 正式页面的 `SAVE_TASK` 不再写入任务。新任务只走 `createTaskPlan`。
- `TaskTransitionService` 拒绝页面声明的子任务完成、已核验检查点和执行标识。
- `updateTaskAtomically` 在同一次存储临界区里检查版本、执行证据并写入。
- 模板摘要改为排序后的 JSON 键值对。依赖快照只包含本任务文件引用的客户。缺少快照的旧任务标记为 `LEGACY_DEPENDENCY_UNKNOWN`，只读。
- 已有客户必须带预期版本。同一 Background 实例内的配置包修改进入队列。该队列不是跨进程事务。
- 同一账号代际内，每个修改请求都返回自己的结果。只有账号切换才丢弃旧回执。
- 成功的文件查询响应记入会话级快照。所选文件都在快照中时，来源为 `SEARCH_RESPONSE_OBSERVED`。没有按 ID 回读，不标记 `FILE_READBACK_VERIFIED`。

生产邮件写操作和生产流程写操作保持关闭。
