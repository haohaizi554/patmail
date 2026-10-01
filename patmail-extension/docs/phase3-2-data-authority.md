> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 数据写入入口

## 调用链

完整页面和历史模板区的客户、本地模板、规则写入：

`CustomersPage` / `QueryTemplateSection` / `RulesPage` / `MailWorkspace`
→ `WORKSPACE` 消息（`saveCustomer`、`deleteCustomer`、`saveQueryTemplate`、`deleteQueryTemplate`、`saveRules`）
→ `handleWorkspaceMessage` 的 `mutationGuard`
→ `recheckBoundSession` 重新读绑定标签页的 `GetUserModel`
→ `accountScopeMatches` 核对调用方带来的 `expectedScope`
→ `saveCustomerAccount` / `deleteCustomerAccount` / `saveQueryTemplateAccount` / `deleteQueryTemplateAccount` / `saveRuleAccount`
→ `CustomerQueryService` 或 `BundleTemplateRepository` 或 `MailRuleRepository`
→ `ChromeBundleRepository` / `chrome.storage.local`
→ `refreshStaleTasks`
→ 返回当前账号快照

`expectedScope` 只表示页面当时看到的 origin、operator、tab、connectionVersion。Background 不把它当成身份。

## 客户版本

`CustomerQueryProfile.revision` 缺省按 1。编辑保存必须带 `expectedRevision`。存储中的版本不一致时抛出「客户配置已被其他页面更新，请重新读取后再保存。」，不覆盖。

客户名称、EASY GUID、基础模板、查询覆盖、启用状态进入 `customerIdentities`。这些字段变化后，`validateTask` 把未进入未知/只读的旧任务标成 `STALE`。客户管理和历史模板页都走 `saveCustomer`，所以两条路径都会重新核验。

## 模板

本地模板更新核对 `expectedVersion`，由后台递增版本。`source !== 'local'` 的保存和删除直接拒绝。EASY 历史模板仍只通过原有 API Runtime 读取。

## 不再直接写存储的界面

- `src/floating/QueryTemplateSection.vue`
- `src/floating/FileSearchPanel.vue` 的客户列表改为 `workspace.load`
- `src/floating/MailWorkspace.vue` 的规则保存带 `expectedScope`
