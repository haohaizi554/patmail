# PatMail Phase 2.1 API 契约

依据仓库 `API/00-通用约定.md`、`API/01-登录用户.md`、`API/04-文件查询.md`、`API/05-文件查询字段映射.md` 及只检查结构的现有 HAR。HAR 中两种请求均有已记录的方法与表单字段；两份响应正文未保留，因此真实响应形状仍须现场确认。本文件只描述本阶段已实现的只读契约。

## 固定边界

生产 Origin 为 `http://183.36.43.66:88`。`localhost` 和 `127.0.0.1` 仅供本地 Mock 验收。没有从页面消息接收目标 URL、Handler、Call 或 HTTP 方法的通道。正式权限由 `manifest.json` 限定到这些站点。

| 操作 | 方法与 Handler | Call | 表单与会话 |
|---|---|---|---|
| 检查会话 | POST `/AjaxServers/Login.ashx` | `GetUserModel` | `Call`、空 `log_pagename`；`application/x-www-form-urlencoded`，浏览器同源凭据。 |
| 查询文件 | POST `/AjaxServers/CaseInfo.ashx` | `GetSearchFiles` | 已记录的 117 项中发送 116 项，省略旧前端 `_doneCallback`；未使用条件传空字符串。 |

文件参数 Builder 实际输出的字段顺序与 `API/04-文件查询.md` 编号列表一致；单元测试逐项比对文档。`_doneCallback` 是旧前端回调序列化产物，不属于业务条件。`order_by_search` 只在排序时出现，本阶段未实现排序，因此不发送。`_t` 每次请求取毫秒时间戳；`IsFirst=false`；`log_pagename=FileSearch.aspx`。不允许全部筛选条件为空，页码从 1 开始，每页 1～100 条。

| UI 查询字段 | EASY 表单字段 | 转换 |
|---|---|---|
| 我方文号 `caseVolume` | `case_volume` | 去首尾空白。 |
| 申请号 `applicationNo` | `app_no` | 去首尾空白并移除 `.`。 |
| 客户名称 `customerName` | `customer_name_vague` | 去首尾空白。 |
| 附件名称 `fileName` | `file_name` | 去首尾空白。 |
| 文件描述内部 ID `fileDescriptionId` | `filetype` | 可由未来配置传入，当前浮窗无树选择器；只接受 GUID 列表，不把中文显示名当 ID。 |
| 页码、每页条数 | `pageIndex`、`pageSize` | UI 默认 1、20；分页沿用原查询条件。 |

当前环境默认值：`fileclass=general`、`case_type=31D1A147-2931-43B5-94AE-B72B1525BA8A`、`is_pat=0`、`colsel` 为 `API/04` 中的当前页面列串。这些取值来自现有环境，不是全局常量；现场若不同，需核实后调整配置。其余未启用条件为空字符串。

## 响应和错误

Transport 可解析 `text/plain` 中的 JSON；401/403、登录重定向或登录 HTML 归类为会话失效，其他 HTML 和无效 JSON 分开处理。公共 `ClientInfo` 的布尔字段只接受明确的布尔值，缺失不会补成 `true`。`IsLogin=false` 优先于业务失败；`Status=false` 或 `Result=false` 为业务失败。

`GetUserModel` 只返回给 UI 一个 `SessionSummary`：`status`、`checkedAt`，可选的 `message/displayName/userId` 目前不编造。未知结构返回 `AUTH_UNKNOWN`，诊断只包含经脱敏的顶层字段名。内部暂存的原始模型不跨消息通道。

`GetSearchFiles` 要求明确的登录与成功信号，读取 `TableRows` 数组或 `null`，把字符串 `TableRowsCount` 校验为安全的非负整数。每条记录至少需要 `file_id`、`file_name`；可选映射包括 `file_desc`、`case_volume`、`app_no`、`customer_name`、`post_date`、`file_status` 等。输出为 `FileSearchResult { items, total, pageIndex, pageSize, totalPages }`，日期保留服务端原始字符串，不推测时区。**只有有效成功响应且总数为 0 时，UI 才显示空结果。**

错误码：`INVALID_ORIGIN`、`INVALID_QUERY`、`NETWORK_ERROR`、`REQUEST_TIMEOUT`、`HTTP_ERROR`、`SESSION_EXPIRED`、`AUTH_UNKNOWN`、`BUSINESS_ERROR`、`INVALID_RESPONSE`、`UNEXPECTED_HTML`、`REQUEST_ABORTED`。`ApiError` 仅携带码、简短信息、可选 HTTP 状态与脱敏字段名；不含 Cookie、Token、原始响应或请求体。HTTP 502/503 不被误判为未登录。

## 待现场验证

- `GetUserModel` 的真实正文结构和是否始终提供 `ClientInfo.IsLogin`；现有 HAR 无响应正文。当前实现遇到未知结构会阻止文件查询。
- 文件列表真实记录是否始终含 `file_id`、`file_name`，可选字段的实际类型及 `TableRowsCount` 的边界表现。
- 该租户当前的 `case_type`、`fileclass`、`is_pat`、`colsel` 是否与记录时一致，以及首页直接查询是否接受这些值。
- HttpOnly Session 在真实 Chrome/EASY 页面中的同源请求行为、登录失效时实际状态码或 HTML 形态。自动化只验证了本地 Mock。
