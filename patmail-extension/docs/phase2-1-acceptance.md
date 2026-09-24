# Phase 2.1 真实 Chrome 验收清单

2026-09-24 用授权测试账号做了只读核对。过程没有把 Cookie、密码或完整用户模型写入仓库。下面区分已经做完的步骤和仍建议人工再看的步骤。

## 已完成

1. `patmail-extension/` 中单元测试 62 项通过，`vue-tsc --noEmit` 通过，`vite build` 与 content 构建通过，`node tests/extension.e2e.mjs` 13 项通过。
2. Playwright Chromium 以无头方式加载 `dist`。扩展出现在登录页；先收起浮窗，再使用原网站登录表单登录，避免浮窗挡住登录按钮。
3. 登录后进入 `/index.aspx`。打开「文件查询」，状态为「已登录」。显示名使用现场确认的 `UserModel.Name`；E2E 用同样字段断言浮窗会显示它。这次现场日志没有单独抄下姓名。
4. 用文档中的我方文号查询。浮窗显示「共 24 个文件」，第一页 20 张卡片，没有 `undefined` 或 `[object Object]`。
5. 「下一页」到达「第 2 / 2 页」。换成不存在的文号后显示「没有符合条件的文件」。
6. 清除该测试浏览器的 Cookie 后点「重新检测」，状态变为「登录已失效」。随后删除临时浏览器配置。
7. 同一会话的直接接口核对：`GetUserModel` 在 `Result=false` 时仍表示已登录；无 Cookie 时返回短 HTML「出错了!」；文件查询第二页 4 条，空条件总数为 `"0"` 且 `TableRows=null`。

## 建议再人工看一眼

1. 在日常 Chrome 打开 `chrome://extensions`，加载 `patmail-extension/dist`，确认扩展页没有报错。本次用的是 Playwright 自带 Chromium，不是日常 Chrome 配置。
2. 在原网站点击退出，而不是只清 Cookie。确认再次检测为未登录或已失效，恢复登录后可以继续查询。
3. 打开文件查询 iframe 页面，确认浮窗仍在、查询不依赖 iframe，原站表格和按钮仍可操作。
4. 在真实首页点「页面扫描」，确认不把 PatMail 自己算进控件，并试一次拖动、收缩和关闭。本地 E2E 已覆盖这些交互。

记录时只写日期、浏览器、页面路径、成功或失败和脱敏错误码。不要保存真实请求体、用户模型、Cookie 或文件内容。
