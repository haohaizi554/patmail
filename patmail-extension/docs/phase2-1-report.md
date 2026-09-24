# PatMail Phase 2.1 交付报告

## 现有架构审计与保留范围

项目实际位于 `patmail-extension/`，已有 Manifest V3、Vue 3/TypeScript/Vite、顶层 Content Script、Background PING、Popup、Shadow DOM + 手动 Popover 浮窗、拖拽/收缩/关闭、统一消息、L2 DOM Scanner、Vitest 和 Chromium E2E。稳定的注入器、扫描器、Popup 与构建配置保持原结构；本次只在浮窗增加文件查询视图，并扩展消息协议和 Content Script 分发。API、rules、automation、services 原有预留位置未被搬迁。

## 修改与新增

修改：`src/content/index.ts`、`src/shared/message.ts`、`src/floating/App.vue`、`src/floating/style.css`、`src/api/README.md`、`src/services/api.ts`、`tests/message.test.ts`、`tests/extension.e2e.mjs`、`README.md`。

新增：`src/api/{config,types,transport,response-guards,session,file-search-params,file-search-types,file-search-normalizer,client,message-guards}.ts`、`src/floating/FileSearchPanel.vue`、`tests/{easy-transport,easy-session,easy-runtime,file-search-params,file-search-normalizer}.test.ts`、`docs/phase2-1-{plan,architecture,api-contract,acceptance,report}.md`。

## 已实现能力

- 固定 Origin/Handler/Call/POST 的只读 API Runtime；Content Script 同源请求复用浏览器会话，不读取或存储 Cookie。
- `GetUserModel` 明确状态检查；未知真实响应结构安全失败，不编造用户名。
- `GetSearchFiles` 文档字段 Builder、参数校验、无条件查询拦截、当前环境配置隔离、运行时响应校验与 `PatentFile` 标准化。
- 文件查询视图：登录状态、四项文本筛选、文件卡片、分页、刷新、空结果和错误提示；请求超时、取消、重复查询合并与旧结果竞态防护。
- 原 Phase 1 页面扫描、Popup、浮窗交互及重复注入控制通过回归；没有业务写操作。

## 验证状态

| 类别 | 结果 |
|---|---|
| A. 自动化 | `pnpm test`、`pnpm typecheck`、`pnpm build` 和 `pnpm test:e2e` 通过；本地 Chromium 使用 HttpOnly Mock Cookie 验证同源会话、文件查询、分页、刷新、空结果、失效及 Scanner 共存。具体最新数量以命令输出为准。 |
| B. 真实 EASY 会话 | **未验证**。本机未取得获授权的真实登录会话；没有声称真实列表已读取。 |
| C. 待现场验证 | `GetUserModel` 正文结构、真实 `GetSearchFiles` 行形状、当前租户默认配置、真实 Cookie/登录失效行为、Chrome 手动加载和原站兼容。步骤见 `phase2-1-acceptance.md`。 |

## 已知限制与后续依赖

文件描述树选择器本阶段没有 UI；`fileDescriptionId` 只作为接受内部 GUID 的模型与 Builder 入口。当前配置源自文档记录，变更租户需现场核实。查询只支持四项文本筛选、每页 20 条，不排序、不拉取整个文件库。响应校验偏保守：真实字段结构若与文档不符，会返回格式错误而不是猜测映射。自动化环境模拟 EASY，不等同于真实现场验收。

Phase 2.2 可以在真实响应和租户配置确认后接入 `SearchQueryHisList`、解析 QueryXml、保存本地查询模板并做客户条件覆盖；本阶段没有实现这些功能，也没有自动发文、下载、后端或写接口。
