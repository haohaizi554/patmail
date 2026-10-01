> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.1 实施计划

依据：用户的 Phase 2.1 Goal、仓库 `API/00`、`04`、`05`。在现有插件结构内增量实现；保留 Phase 1 功能，不读取或保存 Cookie 值，不发写业务请求。真实 EASY 登录会话不可用时只标记现场验收 PENDING。

## 文件边界

- `src/api/config.ts`：固定 EASY API Origin、当前环境查询配置；本地页面仅验收 Scanner。
- `src/api/{types,transport,response-guards,message-guards}.ts`：API 结果/错误、两项操作白名单、同源表单 POST、超时/取消、HTML/JSON 与消息校验。
- `src/api/{session,file-search-types,file-search-params,file-search-normalizer,client}.ts`：会话摘要、116 个有依据参数及 `_doneCallback` 例外、文件结果标准化与运行时生命周期。
- `src/content/index.ts`：复用 MessageBridge，按会话状态门控查询、分别管理会话和文件请求。
- `src/shared/message.ts`、`src/floating/{App.vue,FileSearchPanel.vue,style.css}`：新增强类型消息和一个文件查询视图；保留原页面扫描。
- `tests/`：文档对照参数测试、Mock Fetch 单测、本地真实 Chromium Cookie/Content Script 路径回归。
- `docs/phase2-1-{architecture,api-contract,acceptance,report}.md`：交付说明。

## 任务顺序与验证

1. **契约与参数：**先写 117 字段文档对照、`_doneCallback` 例外、筛选映射、编码、页码和当前环境配置测试并见红；实现查询 Builder 后见绿。
2. **传输与解析：**先写 origin/Handler/Call 限制、同源凭据、超时取消、网络/HTTP/HTML/JSON/ClientInfo 错误测试并见红；实现受限 Transport 和响应校验后见绿。
3. **Session 与结果：**先写未知响应、未登录、失效和文件缺字段/空值/总数/分页测试并见红；实现摘要、内存态原始对象和文件标准化后见绿。
4. **消息和 UI：**先写消息边界与请求竞态测试并见红；扩展原消息协议和 Content Script 单实例运行时，在现有浮窗增加文件查询视图。旧响应不得覆盖新结果；关闭取消请求。
5. **浏览器验收：**用本地服务模拟 EASY 的只读接口与 Session Cookie，测试自动携带会话、UI 查询和 Phase 1 扫描共存；不得调用真实生产接口作为自动测试。
6. **交付：**运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:e2e`，生成四份文档并逐项复核 Definition of Done。

## 风险裁定

`GetUserModel` 响应正文未落盘：只有显式、通过运行时校验的认证信号才允许查询；未知结构给出 `AUTH_UNKNOWN` 和脱敏键名诊断，不编造姓名。当前租户的 `case_type`、`fileclass`、`is_pat`、`colsel` 源自 `API/04`，置于环境配置，可现场替换；不视为全局事实。页面关闭和会话失效只清空内存查询结果，不操作网站或 Cookie。
