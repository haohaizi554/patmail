> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.0 EASY 桥

`EasyConnectionContext` 包含：

- `easyOrigin`：固定为 `http://183.36.43.66:88`
- `easyTabId`：用户选定的标签页
- `operatorId`：该标签页 `GetUserModel` 返回的 GUID
- `sessionStatus`
- `lastCheckedAt`
- `displayName`
- `message`

没有 EASY 标签页时，页面显示「尚未连接 EASY」，并提供「打开 EASY 登录页面」。有一个或多个标签页时都列出来，必须点「连接所选标签页」。后台不会取列表第一项。

绑定后检查 `tabId` 和 URL Origin。Origin 不是 EASY、标签页关闭、或刷新后，身份会被清空。再次检测如果 GUID 变了，只加载新用户的数据。

`FullPageEasyBridge` 只允许这些内容脚本消息：会话检测、文件查询、字典、历史模板、只读邮件/流程查看、只读验收。写邮件请求会被拒绝。

后台在转发前再次确认目标标签页仍在 EASY Origin。验收按钮走 `runAcceptance`：内容脚本带回 probe，后台用 `LiveEasyAcceptanceRunner` 自己计算结果并保存。页面不能提交 `result=PASS` 来生成正式证据。

本次浏览器验收使用 Playwright 拦截的 EASY fixture，以及 cookie `pm_fixture_session=active`。这证明了绑定、会话检测和 `GetSearchFiles` 的通道。它不是对 `183.36.43.66` 真实登录会话的现场验收。
