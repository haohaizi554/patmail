# Phase 3.0 界面迁移

| 原型 | 真实模块 | 完整页面 |
|---|---|---|
| HomePage、StatsPage | 已保存任务、客户、规则的计数 | `#/` |
| FilePage | EasyRuntime、GetSearchFiles、SchemaQueryForm、QueryTemplateSection、FileSearchPanel | `#/files` |
| CustomerPage | CustomerQueryProfile、CustomerQueryService、BundleCustomerRepository | `#/customers` |
| 查询模板区 | QueryBundle | `#/templates` |
| RulePage | MailRuleBundle、MailRuleRepository | `#/rules` |
| TaskPage | AutomationTaskService、Checkpoint、Ledger | `#/tasks` |
| 邮件草稿 | 已保存任务里的本地计划 | `#/drafts` |
| 工作流面板 | 只读说明，写开关关闭 | `#/workflow` |
| RecordPage | 从任务状态推导 | `#/records` |
| 浮窗 | SHOW_PANEL 兼容入口 | 不是正式路由 |
| 验收面板 | Background 重算只读验收 | `#/acceptance` |
| 设置 | 连接状态与写门禁 | `#/settings` |

视觉保留粉色工作台：顶栏、左侧导航、内容区、统计卡片和表格。导航使用 hash，支持刷新、后退和 `app.html#/files` 这类深链接。

仓库里没有可用的 `/assets/icons` 与 `/assets/background` 图片。品牌区使用内联字形，不请求 `localhost:5173`。

正式构建不引用根目录 `src/data.js`。开发预览在扩展后台不存在时显示 `DEMO`，数据区保持空白。没有任务时发文记录显示「暂无记录」，不显示「已成功发送」。

本地客户配置 ID 与 EASY customer GUID 分开展示。任务详情里的条目状态使用 `describeTaskRecord` / `describeItemRecord`。
