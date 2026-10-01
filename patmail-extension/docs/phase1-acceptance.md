> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 1 人工 Chrome 验收

适用版本：PatMail 0.1.0，Chrome 114+。验收使用已授权的 EASY 测试账号与页面；只执行只读扫描，不提交业务表单。若现场页面不可访问或未登录，记录实际状态，不把本地夹具通过等同于 EASY 通过。

1. 在 `patmail-extension/` 执行 `pnpm install`、`pnpm test`、`pnpm typecheck`、`pnpm build`。
2. Chrome 打开 `chrome://extensions`。
3. 开启右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」（Load unpacked）。
5. 选择 `patmail-extension/dist`，确认扩展显示为 PatMail，且无 Manifest 错误。
6. 打开授权范围内的普通网页，例如 `http://127.0.0.1:<port>/` 本地验收页，或经授权的 `http://183.36.43.66:88/`。已打开的网页需要刷新。
7. 确认右侧出现一个 PatMail 浮窗；DevTools Elements 中应只有一个 `patmail-root#patmail-extension-root`，Vue 内容位于其 ShadowRoot 内。检查页面原有按钮、输入框仍可使用。
8. 拖动标题栏到视口边缘，确认无法拖出屏幕；缩小窗口后仍能看到浮窗。点「收起」，保留小入口；点「展开」，恢复原位置。
9. 点「扫描页面」，确认当前 URL、标题、input/select/button、textarea、可见、隐藏和语义识别数量。扫描时不得点击网页按钮或提交表单。
10. 点「查看 DOM」，确认显示 V2、页面元信息、统计与最多 20 个控件的调试预览。点「复制 JSON」，将剪贴板粘贴到本地文本编辑器，确认包含完整 `version: 2`、`page`、`controls`、`stats`、`iframes`、`scannedAt`，密码/文件值为 `[REDACTED]`，没有 Cookie/Token 值。
11. 点「关闭」，确认浮窗消失、页面仍能正常操作；通过工具栏 Popup 的「打开浮窗」可恢复，且不出现第二个实例。
12. 刷新网页，确认浮窗自动重新出现；若业务系统是 SPA，切换路由后也应保持单实例。对会局部替换 `body` 内容的页面，确认浮窗可恢复，手动关闭后不会被局部更新重新打开。

## EASY 页面专项烟测

在获授权且可访问的环境中逐一访问：

- `http://183.36.43.66:88/Forms/Patent/FileSearch.aspx`
- `http://183.36.43.66:88/Ihgforms/Patent/FileSearchMail.aspx`
- 实际导航到的 `CaseManage.aspx` 页面（以业务系统真实完整路径为准）

每页记录：最终 URL/是否登录或跳转、浮窗是否出现、扫描耗时 `stats.durationMs`、控件总数与可见/隐藏数、是否有 iframe、控制台错误、页面原有查询与表单操作是否仍正常。对 jQuery、layui、ASP.NET WebForms、table 布局和老 CSS 页面，重点检查宿主数量、样式隔离、表格标签候选、网页按钮的原行为。若页面将业务表单置于 iframe 内，当前版本仅报告 iframe 元信息，不扫描内部控件；记录这一限制，不尝试跨域访问。

扫描结果可能包含普通表单值；仅在获授权的环境复制和保存 JSON。测试结束后清除本地临时粘贴内容。

## 可重复的自动化验收

`pnpm test:e2e` 使用测试专用 Playwright/Chromium，在本地夹具上加载真实 `dist`，覆盖自动注入、Shadow DOM、消息、扫描、复制、拖动、折叠、关闭/刷新、body transform 与局部替换。输出保存在 `test-results/`。该测试不访问 EASY，也不把 Playwright 放入产品运行时。
