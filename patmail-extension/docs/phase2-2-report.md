# Phase 2.2 交付报告

日期：2026-09-24。范围停在查询模板和客户查询配置。

## 已实现

- 历史模板列表 `getHistoryQueryList` 与详情 `getHistoryQueryDetail`，经现有 `EasyRuntime` / `EasyTransport` 调用 `SearchQueryHisList`。
- `Options: null` 视为空列表。未知结构返回 `INVALID_RESPONSE`。
- 列表内存缓存 60 秒，可强制刷新；用户 ID 变化或退出后失效。详情不会在 `Options` 为 null 时清掉这份缓存。
- `DOMParser` 解析 `xmlRoot`。显示文本与请求值分开。未知字段保留在 `unknownFields`，不发送。
- 复用 Phase 2.1 的 116 项 `FILE_SEARCH_REQUEST_FIELDS`，另加 API/05 的 16 个 XML 节点改名，没有第二份字段表。
- 本地模板的新建、改名、改字段、复制、导入和删除。删除只作用于 `source: 'local'`。
- 客户配置：名称、基础模板、覆盖字段、启用状态。可选的原网站客户 ID 必须是 GUID。
- `resolveQueryTemplate`：临时覆盖高于客户覆盖，客户覆盖高于基础模板。空字符串是有效覆盖。
- 文件查询浮窗增加查询来源。手动查询保留。模板和客户查询先预览，再调用原来的 `GetSearchFiles`。翻页沿用 `resolvedFields`。
- 没有有效筛选，或只有案件类型 / 文件来源时，不发全库查询。
- `chrome.storage.local` 权限和版本包 `patmail.query.v1`。

## 已通过 Mock 测试

`tests/query-template.test.ts` 覆盖历史列表、空列表、非法响应、会话失效、超时、指定 ID、缺失模板、XML 正常与拒绝路径、三层合并、空字符串、原型污染、Builder 分页、全库保护、本地模板 CRUD、客户 GUID、存储版本。既有 Phase 2.1 测试仍在同一轮 `vitest` 中运行。

2026-09-24 本轮：`vitest run` 10 个文件、74 项通过。

## 已通过真实 EASY 环境验证

Phase 2.1 已在 2026-09-24 用授权测试账号核对过：登录态、手工 `GetSearchFiles`、分页、空结果、会话失效。那些结论不重复算作本阶段历史模板验证。

本阶段没有对 `SearchQueryHisList` 再做一次真实调用。接口形状沿用仓库里已有的 [API/03-历史查询条件.md](../../API/03-历史查询条件.md)。

## 尚待验证

- 在已登录的 EASY 页面打开浮窗，刷新历史模板，确认列表标题和某条 `query_xml` 能解析。
- 导入为本地模板后再次刷新，确认本地副本不被原站内容覆盖。
- 选择客户、预览覆盖来源、查询，并翻到下一页，确认条件仍在。
- 切换账号后，`unscoped` 与 GUID 命名空间是否分开。GetUserModel 没有 `user_id` 时，本阶段明确不做多账号隔离。
- HTTP 502/503 文案、原站退出按钮、日常 Chrome 配置。这些在 Phase 2.1 也尚未在真实环境点过。

## 当前限制

- 不写、不删原网站历史模板。
- 本地模板和客户配置只在本机 `chrome.storage.local`。没有 FastAPI。
- 拿不到用户 GUID 时，存储键是 `unscoped`，同一浏览器配置里的未识别会话会看到同一份本地模板。
- 临时条件只有我方文号、申请号、附件名称。其他覆盖在客户配置或本地模板里编辑。
- 文件描述的中文名称来自 XML 的 `*_text`。本阶段没有调用字典接口把新的 GUID 翻译成名称。
- 开发构建里可以展开参数结构，只显示字段名、来源和字数。

## 下一阶段依赖

Phase 2.3 计划使用只读字典把内部 GUID 映射成显示名称，并生成可配置查询表单。预留接口：

```text
IPGetBasicData
GetFlowdirection
LoadFileTypeByCaseType
GetFieldColumn
LoadListColumn
```

本阶段没有实现这些调用。

## 验证命令

2026-09-24 在 `patmail-extension` 执行：

| 命令 | 结果 |
|---|---|
| `vitest run`（`pnpm test`） | 10 个文件、74 项通过 |
| `vue-tsc --noEmit`（`pnpm typecheck`） | 通过 |
| `vue-tsc --noEmit` 之后的 `vite build` 与 content 配置构建 | `dist/popup.js`、`dist/content.js` 生成 |
| `node tests/extension.e2e.mjs`（`pnpm test:e2e`） | 13 项浏览器检查通过 |

CI 没有访问真实 EASY。
