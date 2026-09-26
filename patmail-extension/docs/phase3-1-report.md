# Phase 3.1 报告

## 实际调用链

`app.html` → `useWorkspace` / `full-page-bridge` → 后台 `handleWorkspaceMessage` 或 `scopeExtensionPageMessage` → 既有客户包、`MailRuleRepository`、`IndexedTaskStore`。

文件查询、会话检测和只读验收再由后台转发到用户选中的 EASY 标签页。内容脚本用该页的 `location.origin` 发请求。计划组件使用传入的 EASY Origin，不再使用扩展页面的 `location.origin`。

## 修改文件

- `src/shared/connection.ts`
- `src/shared/message.ts`
- `src/background/index.ts`
- `src/background/workspace.ts`
- `src/background/account-data.ts`
- `src/mail/repository.ts`
- `src/api/client.ts`
- `src/automation/acceptance-context.ts`（新增）
- `src/automation/acceptance-runner.ts`
- `src/automation/snapshot.ts`
- `src/content/index.ts`
- `src/floating/AutomationPanel.vue`
- `src/floating/ControlledExecutionPanel.vue`
- `src/floating/LiveAcceptancePanel.vue`
- `src/floating/MailWorkspace.vue`
- `src/app/composables/useWorkspace.ts`
- `src/app/record-status.ts`
- `src/app/pages/CustomersPage.vue`
- `src/app/pages/RulesPage.vue`
- `src/app/pages/TasksPage.vue`
- `src/app/pages/DraftsPage.vue`
- `src/app/pages/WorkflowPage.vue`
- `src/app/pages/AcceptancePage.vue`
- `src/app/components/rules/`（新增六个编辑器）
- `tests/phase3-0.test.ts`
- `tests/phase3-1.test.ts`（新增）
- `tests/extension.e2e.mjs`

## 验证分层

源码实现：上面的调用链和写入入口。

单元测试：`pnpm test`，19 个文件，143 项通过。覆盖候选连接不能直接变成已登录、过期会话结果不能覆盖新绑定、客户 overrides 保留、过期规则版本被拒绝、扩展 Origin 的任务被拒绝、EASY Origin 的 `SaveTask` 能经后台消息读回、缺参验收不发请求。

类型检查与构建：`pnpm typecheck` 通过，`pnpm build` 通过，产物包含 `dist/app.html` 和 `dist/app.js`。

Full-page E2E：`pnpm test:e2e`，15 项浏览器检查通过。`FullPageBusinessFlow` 在脱敏 fixture 上点击页面：绑定标签页、保留查询覆盖、跨页选择文件、生成并保存任务、核对 EASY Origin、刷新后恢复、规则变更后任务变为过期、缺参 `BLOCKED`、502 为 `FAIL`、无对照不升级、旧浮窗手动打开、规则版本冲突、账号切换后看不到上一账号、关闭 Service Worker 后重新检测会话。

真实 EASY 现场验证：未做，保持 `PENDING`。fixture 不代表生产验收通过。

生产写：`MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd` 仍关闭。没有新增远程后端。

Phase 3.1 到此停止，不进入 Production Write。
