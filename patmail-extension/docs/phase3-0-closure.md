> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.0 收口

Phase 3.0 打开了 `chrome-extension://<id>/app.html`，图标会聚焦或创建这个页面，默认不再注入悬浮窗。数据路径是完整页面消息到后台，再进既有 Repository。

代码审计确认业务迁移还没有完成，因此不能把 3.0 当成发文计划闭环：

- 文件页里的计划、测试执行和验收仍用 `location.origin`。在 `app.html` 上这是扩展 Origin，后台保存任务会拒绝。
- 客户保存把 `overrides` 写成空对象。
- 规则有两条写入：规则页走后台，浮窗里的 `MailWorkspace` 直接 `MailRuleRepository.update`。
- 连接状态只在 Service Worker 内存里，重启后不能恢复候选标签页。
- 验收请求缺少邮件、案件类型和流程参数。

这些缺口由 Phase 3.1 在同一套 Repository 上收口，没有另建客户、规则或任务库，也没有打开生产写。
