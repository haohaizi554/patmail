# Phase 3.4 任务权威

## 正式入口

新任务由完整页面调用 `Workspace.createTaskPlan`。Background 读取当前账号的规则、客户和模板，经 `planTrustedTask` 生成任务，再写入任务存储。

`SAVE_TASK` 仍留在消息协议里，供历史页面调用时得到明确拒绝。处理顺序是：

1. 拒绝页面声明的完成、未知、已发送请求、邮件或流程标识，以及无法重算的指纹。
2. 拒绝页面声明的子任务完成、已核验或已收到响应的检查点。
3. 一律返回「正式页面不能提交完整任务。」，不插入、不覆盖。

页面不能提交 `taskId`、`taskFingerprint`、`status`、`item.status`、`checkpoints`、`requestSent`、`responseReceived`、`verified`、`easyMailId`、`mailExecutionId`、`workflowExecutionId`、`verifiedAt` 来让系统接受执行结论。

## 状态转换

`src/automation/task-transition.ts` 声明当前状态、事件、下一状态、执行来源和必要证据。例如 `CREATED` 到 `DRY_RUN_COMPLETED` 只来自本地 Dry-run。邮件创建状态只来自邮件执行和核验，不来自页面提交的 `item.status=COMPLETED`。

构造 `task.status=READY`、`item.status=COMPLETED`、`checkpoint.verified=true`、`requestSent=false` 时，拒绝原因是子任务完成或检查点核验，而不是只看 `requestSent`。

## 原子更新

`updateTaskAtomically(origin, operatorId, taskId, expectedVersion, transition)` 在同一次临界区里：

1. 读取最新任务。
2. 比较 `recordVersion`，缺失时按 1。
3. 拒绝清掉 `UNKNOWN`、`RUNNING`、已发送检查点、已核验检查点、已有邮件或流程标识。
4. 写入新记录并把版本加一。

IndexedDB 实现把上述步骤放在同一个 `readwrite` 事务里。测试用的 `SerialTaskStore` 把它们放在同一个队列回调里。网络请求不在事务中。

两个调用同时更新同一 `taskId` 时，先完成的 `UNKNOWN` 写入把版本加一。后一个仍持有旧版本并提交 `READY` 的调用得到「任务版本已变化。」，库里的状态保持 `UNKNOWN`。

`chrome.storage` 上的 `TaskRepository` 只在当前进程内排队。它不是跨进程事务数据库。
