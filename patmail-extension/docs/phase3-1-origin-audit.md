> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.1 Origin 审计

完整页面的 `location.origin` 是 `chrome-extension://...`。EASY 业务 Origin 是 `http://183.36.43.66:88`。后台 `SaveTask` 要求 `task.origin === connection.easyOrigin`。

## 已修复的业务误用

这些组件以前用 `location.origin` 组装任务、执行范围或验收列表：

- `src/floating/AutomationPanel.vue`：计划输入、任务列表、任务详情
- `src/floating/ControlledExecutionPanel.vue`：任务 Origin 和测试范围 `allowedOrigin`
- `src/floating/LiveAcceptancePanel.vue`：页面 Origin 和验收列表

它们现在接收 `businessOrigin`。`MailWorkspace` 把 `accountOrigin` 传下去。完整页面的文件查询把 `connection.easyOrigin` 作为 `pageOrigin`。

## 仍然出现 location.origin 的位置

- `src/content/index.ts`：`EasyRuntime(location.origin)` 以及内容脚本里的验收记录 Origin。内容脚本运行在 EASY 文档上，这个 Origin 就是业务站点。
- `src/floating/FileSearchPanel.vue`、`MailWorkspace.vue`、`QueryTemplateSection.vue`：只在没有传入页面 Origin 时回退。完整页面会传入 EASY Origin。浮窗挂在 EASY 页面上时，回退值与业务站点一致。
- `src/content/scanner.ts`：判断 iframe 是否与当前文档同源，不写入账号存储。

业务任务、规则和验收不再从这些组件推断站点。
