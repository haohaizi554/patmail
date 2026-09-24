# PatMail Phase 2.1 交付报告

## 现有架构审计与保留范围

项目实际位于 `patmail-extension/`。Phase 1 已有 Manifest V3、Vue 3/TypeScript/Vite、Content Script、Background PING、Popup、Shadow DOM 浮窗和 L2 DOM Scanner。Phase 2.1 没有另起工程，也没有第二套消息系统或第二个浮窗。本次在已有 API Runtime 上按现场响应修正会话判断，并完成真实会话验收。

## 本次相对上一版的修改

修改：`src/api/session.ts`、`src/api/transport.ts`、`src/api/README.md`、`src/floating/FileSearchPanel.vue`、`tests/easy-session.test.ts`、`tests/easy-transport.test.ts`、`tests/extension.e2e.mjs`、`manifest.json`、`README.md`、`docs/phase2-1-{architecture,api-contract,acceptance,report}.md`。

原因：HAR 没有 `GetUserModel` 正文。现场已登录响应是 `IsLogin=true`、`Status=true`、`Result=false`。旧逻辑把 `Result=false` 当成业务失败，登录后无法查询。无 Cookie 时接口返回短 HTML「出错了!」，不是登录页。

## 已实现能力

- 固定 Origin/Handler/Call/POST 的只读 API Runtime。Content Script 同源请求复用浏览器会话，不读取或存储 Cookie，也不保留 `SessionId` 和 `UserMenu`。
- 已登录时提取 `UserModel.Name`（空则 `user_name`）和 GUID 形式的 `user_id`。未确认字段不编造。
- `GetSearchFiles` 文档字段 Builder、无条件查询拦截、响应校验和 `PatentFile` 标准化。
- 浮窗：登录状态与显示名、四项筛选、文件卡片、20/50/100 分页、刷新、空结果和错误提示；超时、取消和竞态防护保持原样。
- 原页面扫描、Popup 和浮窗交互仍由 E2E 覆盖。没有业务写操作。

## 验证状态

| 类别 | 结果 |
|---|---|
| A. 自动化 | 2026-09-24 复核：`pnpm test` 62 项通过、`pnpm typecheck` 通过、`pnpm build` 通过、`pnpm test:e2e` 13 项通过。Mock 覆盖表单编码、超时、502/503、登录 HTML、未登录短 HTML、`Result=false` 的已登录用户模型、文件参数、空结果和竞态。 |
| B. 真实 EASY 会话 | 2026-09-24 用授权账号完成。直接请求确认用户模型、24 条文件、第二页 4 条、空结果 `TableRows=null`。加载 `dist` 的 Chromium 在原站登录后，浮窗显示已登录，查出 20 张卡片，下一页、无结果和清除 Cookie 后的「登录已失效」均符合预期。未把 Cookie 或业务正文写入仓库。 |
| C. 尚未在现场做 | 真实 502/503 文案、点击原站退出按钮、日常 Chrome 的手动加载页、真实首页上的扫描/拖拽，以及 `FileSearch.aspx` iframe 共存。步骤见 `phase2-1-acceptance.md`。 |

## 已知限制与后续依赖

文件描述树选择器没有 UI；`fileDescriptionId` 只接受内部 GUID。当前 `case_type`、`fileclass`、`is_pat`、`colsel` 已在这个租户的首页查询中被接受，换租户仍要改配置。查询至少要有一项文本条件，不排序，不拉取整个文件库。

Phase 2.2 可以接入 `SearchQueryHisList`、解析 QueryXml 并做客户条件覆盖。本阶段没有实现这些功能，也没有自动发文、下载、后端或写接口。
