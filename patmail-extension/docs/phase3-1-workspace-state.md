# Phase 3.1 工作台状态

`useWorkspace` 仍是模块级的一份 Vue 状态，首页、文件页、客户页、规则页和任务页读同一组 ref。

状态更新来自后台 `WorkspaceResult`：

- `load`、`bind`、`refreshSession`、`saveCustomer`、`saveRules` 会替换客户、模板、规则和任务。
- 会话不是 `authenticated` 时清空这四项，避免退出或失效后继续显示上一账号。
- 账号从 A 换成 B 时，下一次带数据的响应直接换成 B 的 Repository 结果。

`chrome.storage.onChanged` 监听 `patmail.query.*`、`patmail.mail.*` 和 `patmail.connection.snapshot.v1`。已登录时重新 `load`。任务在 IndexedDB，保存成功后计划面板会再调用 `load`，任务页挂载时也会 `load`。

因此刷新 `app.html` 后，任务来自后台 Repository，不来自组件内存。`UNKNOWN`、`STALE`、`PARTIAL_FAILURE` 保持原状态。`COMPLETED` 的说明仍是「本地流程结束，发送未核验」。
