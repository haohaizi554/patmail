# Phase 3.3 可信任务

新计划只由 `Workspace.createTaskPlan` 经后台 `planTrustedTask` 生成。后台保存后返回 `CreatedTaskResult`：

- `taskId`
- `taskFingerprint`
- `status`
- `createdAt`
- `itemCount`
- `persisted`
- `fileSource`

发文计划面板使用这份结果里的 `taskId`，不再从成功句子里解析编号。任务列表、详情和刷新后读到的是同一个持久化编号。

旧 `SAVE_TASK` 仍可插入一个新的 `taskId`，以便 Phase 3.1 的来源校验继续有效。若该 `taskId` 已经存在，并且满足下列任一项，后台拒绝写入，原记录保持不变：

- 状态为 `UNKNOWN`、`RUNNING` 或 `PARTIAL_FAILURE`
- 任一 Checkpoint `requestSent=true`
- `easyMailId` 或 `workflowExecutionId` 非空

因此不能把已发送请求的任务替换成 `status=READY`、`checkpoints=[]`、`easyMailId=''`。

文件选择记为 `VerifiedSelectionSnapshot`，`verification` 为 `FILE_SOURCE_UNVERIFIED`。当前没有可靠的按文件 ID 回读契约，没有新增单文件查询接口。这种任务可以本地规划，不会被当成真实可写任务。`EASY_MAIL_WRITES_ENABLED` 和 `WORKFLOW_WRITES_ENABLED` 仍为 `false`。
