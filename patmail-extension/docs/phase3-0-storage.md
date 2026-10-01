> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.0 存储

数据仍在本机。

- 客户和查询模板：`patmail.query.v1:<easyOrigin>:<operatorGuid>`
- 发文规则：`patmail.mail.v1:<easyOrigin>:<operatorGuid>`
- 任务：`patmail.automation.task.v2:<easyOrigin>:<operatorGuid>`
- 证据：`patmail-evidence`

键里的 Origin 使用绑定的 EASY 站点，不用 `chrome-extension://`。因此完整页面和旧浮窗读写的是同一账号空间，不会再分出第三份客户数据。

未确认 GUID 时，`loadAccount` 返回空列表，`scopeExtensionPageMessage` 拒绝扩展页面读取其他用户。`UNKNOWN` 任务在规则变更后仍保持 `UNKNOWN`。规则内容变化后，未保护的旧任务会被 `validateTask` 标成 `STALE`。

没有新增远程数据库，没有把 Cookie 写入 `chrome.storage`，也没有把 Cookie 交给本地 Python。存储结构没有做破坏性迁移。
