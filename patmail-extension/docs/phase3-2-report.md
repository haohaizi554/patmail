> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 报告

## 结果

完整工作台的客户、本地模板和规则写入都经过 Background 的会话复检和 `expectedScope`。后台用当前客户和规则生成任务，并拒绝页面伪造的完成状态和指纹。只读验收按接口使用已核对参数；HTTP 200 加业务失败、502 和 Mock 都不会记为通过。

真实 EASY 验收：PENDING。

## 代码路径

- 写入：`src/background/workspace.ts`、`src/background/account-data.ts`、`src/customer/service.ts`
- 账号：`src/app/composables/useWorkspace.ts`、`src/shared/connection.ts`、`src/background/index.ts`
- 任务：`src/automation/task-planner.ts`、`src/automation/task-trust.ts`、`src/background/authority.ts`、`src/floating/AutomationPanel.vue`
- 只读：`src/automation/readonly-contracts.ts`、`src/automation/acceptance-runner.ts`、`src/api/client.ts`
- 页面：`src/floating/QueryTemplateSection.vue`、`src/floating/FileSearchPanel.vue`、`src/app/pages/CustomersPage.vue`、`src/app/pages/RulesPage.vue`、`src/app/pages/TasksPage.vue`、`src/app/pages/WorkflowPage.vue`、`src/app/pages/AcceptancePage.vue`
- 测试：`tests/phase3-2.test.ts`、`tests/extension.e2e.mjs`

## 命令与结果

- `pnpm install --frozen-lockfile`：通过
- `pnpm test`：20 files，147 tests 通过
- `pnpm typecheck`：通过
- `pnpm build`：通过
- `pnpm test:e2e`：15 browser checks passed

## 剩余风险

- 真实 EASY 账号没有登录，现场只读对照仍是 PENDING。Fixture 不能当成 LIVE 证据。
- `GetSearchFiles`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 在验收上下文里字段不齐，保持 `CONTRACT_PENDING`，不会发猜测请求。
- 旧 `SaveTask` 仍接受通过指纹重算和状态白名单的本地计划。新计划的正式入口是 `createTaskPlan`。页面预览任务的 ID 与后台保存的 ID 不是同一个。
- 邮件保存、文件关联和流程提交仍然关闭。不要把 Dry-run 或只读结构通过说成业务完成。
