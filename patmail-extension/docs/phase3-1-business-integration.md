> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.1 业务闭环

从 `app.html` 出发的路径：

1. 选择 EASY 标签页并检测 `GetUserModel`。
2. 文件查询经后台转发到该标签页。
3. 客户配置经后台 `saveCustomer` 写入既有客户包。编辑保留原来的 `overrides`，只有勾选「重置查询条件」才清空。名称或 EASY GUID 变化后，相关任务重新核验并可能变为 `STALE`。
4. 选择文件、绑定客户、生成计划。计划 Origin 使用 EASY Origin。
5. `SaveTask` 由后台写入任务库。页面显示是否保存、任务 ID、客户数、文件数、预计邮件数和状态。
6. 任务页立即能看到该任务。刷新后按同一账号再读出来。

规则只有一条写入：

完整页面或浮窗 → 后台 `saveRules` → `MailRuleRepository` → `chrome.storage.local` → `refreshStaleTasks`。

同一账号的保存按存储键排队。提交的 `revision` 必须等于当前版本，否则返回「发文规则已被其他页面更新，请重新读取后再保存。」过期 Bundle 不会覆盖新规则。

规则页包含发文方式、文件描述映射、收件人、抄送、签名、标题、正文和导入。这些组件在 `src/app/components/rules/`。不查询文件也可以保存规则。规则内容变化后，旧计划变为 `STALE`。

草稿页按任务条目区分本地草稿、EASY 邮件已创建、EASY 邮件已保存、实际发送已核验。工作流页要求已有邮件 ID，只读读取流程，默认不提交。

`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED` 和 `productionWriteAllowed()` 保持关闭。
