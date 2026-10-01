> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 任务可信保存

正式新任务入口是 `createTaskPlan`。

页面提交已选文件、当时看到的查询模板版本和 `expectedScope`。Background 自己读取当前 operator、EASY origin、客户配置和发文规则，再调用：

- `queryTemplateVersionOf`
- `customerIdentities`
- `taskFingerprint`
- `planDrafts`
- `buildTask`
- `validateTask`

任务 ID 和指纹由后台生成。初始状态来自 `validateTask`。条目上的 `easyMailId`、`mailExecutionId`、`workflowExecutionId` 和检查点的 `requestSent` 会被清掉。`COMPLETED` 和 `UNKNOWN` 不会作为新计划的已验证状态留下。

分组键包含文件上的 EASY `customerId`。同一个本地 Profile 下，不同 EASY GUID 的文件不会合成一组。每条 `TaskItem` 用 profileId 加 easyCustomerId 选择身份快照，对不上时用空身份，不用另一个客户的 GUID 顶上。

旧 `SaveTask` 仍在，但 `clientTaskRejection` 会拒绝：

- 页面声明 `COMPLETED` 或 `UNKNOWN`
- 页面声明 `requestSent`、邮件 ID 或流程执行 ID
- 指纹与任务内容重算结果不一致

Dry-run 成功只表示本地计划已生成。它不是 EASY 业务完成。
