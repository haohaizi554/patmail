> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.3 报告

本次在 `patmail-extension` 内执行，结果来自这一轮命令，不沿用以前报告里的次数。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm test` | 通过。21 个文件，152 个测试 |
| `pnpm typecheck` | 通过。最后一次 `pnpm build` 里的 `vue-tsc --noEmit` 也通过 |
| `pnpm build` | 通过 |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。Fixture 不算现场通过。

未通过的自动化项目：无。

## 实际修改

- `src/automation/query-dependency.ts`（新增）
- `src/automation/types.ts`
- `src/automation/snapshot.ts`
- `src/automation/task-builder.ts`
- `src/automation/task-planner.ts`
- `src/automation/task-trust.ts`
- `src/automation/task-validator.ts`
- `src/automation/acceptance-runner.ts`
- `src/background/account-data.ts`
- `src/background/authority.ts`
- `src/background/workspace.ts`
- `src/shared/connection.ts`
- `src/shared/message.ts`
- `src/app/composables/useWorkspace.ts`
- `src/app/pages/AcceptancePage.vue`
- `src/floating/AutomationPanel.vue`
- `tests/phase3-3.test.ts`（新增）
- `tests/extension.e2e.mjs`

## 完整页面里核对过的行为

`FullPageBusinessFlow` 这一项里包含：

- 连接 Fixture EASY，查询并选择文件，后台创建任务，页面展示的 `taskId` 与详情、刷新后的详情一致。
- 只修改模板文件描述后，原任务状态为 `STALE`。
- 第二个完整页面在客户保存后能看到新名称。
- 保存客户时同时刷新标签页，页面收到“客户配置已保存。”，编辑按钮仍是一个。
- 已有 `UNKNOWN` 且 `requestSent=true` 的任务，旧 `SAVE_TASK` 被拒绝，Checkpoint 上的邮件编号仍在。
- 手工 `userId` 与响应一致时结果为 PASS，文本包含“未与原网页对照”和“手工期望”，不包含 `UI_COMPARED`。

账号 A 的保存在读取过程中切到 B、以及 A 的迟到响应不能套上 B 的连接，由 `tests/phase3-3.test.ts` 对 `handleWorkspaceMessage` 断言。

## 完成情况

- 旧 `SaveTask` 不能覆盖 `UNKNOWN`、已发送请求或已有邮件/流程编号的任务。
- 模板版本改为内容 SHA-256，模板变化会把旧任务标为 `STALE`。
- 账号读取和保存使用冻结上下文；不匹配时返回 `STALE_CONTEXT`。
- 保存回执不再被后续只读请求丢弃；存储变化会合并后补读。
- 后台返回持久化 `taskId`，页面与仓库使用同一编号。
- 文件来源为 `FILE_SOURCE_UNVERIFIED`。
- 手工对照不能变成 `UI_COMPARED`。
- 生产邮件写入和生产工作流写入仍关闭。

## 剩余风险

- 没有按文件 ID 回读的契约，任务不能升级为真实可写任务。
- `GetSearchFiles`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 仍是 `CONTRACT_PENDING`。
- 旧 `SAVE_TASK` 对一个尚不存在的 `taskId` 仍可插入。正式入口是 `createTaskPlan`。
- 真实 EASY 的用户、客户、文件描述、发文类型、邮件和流程只读核对尚未进行。
