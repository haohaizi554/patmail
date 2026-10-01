> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# PatMail Phase 2.1 API 契约

依据仓库 `API/00-通用约定.md`、`API/04-文件查询.md`、`API/05-文件查询字段映射.md` 及只检查结构的现有 HAR。HAR 没有保存这两次响应正文。2026-09-24 用授权账号做了只读核对，下面同时写已实现契约和当天确认的响应形状。账号、Cookie 和业务正文不写入本文。

## 固定边界

业务 API 唯一受信任 Origin 为 `http://183.36.43.66:88`。`localhost` 和 `127.0.0.1` 只用于页面扫描开发；自动化浏览器测试拦截固定 EASY Origin 并返回 Mock 响应，不访问真实服务器。没有从页面消息接收目标 URL、Handler、Call 或 HTTP 方法的通道。注入权限由 `manifest.json` 限定到这些站点。

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
| 页码、每页条数 | `pageIndex`、`pageSize` | UI 默认第 1 页、每页 20 条，可选 20/50/100；切换数量回到第一页，分页沿用已提交条件。 |

当前环境默认值：`fileclass=general`、`case_type=31D1A147-2931-43B5-94AE-B72B1525BA8A`、`is_pat=0`、`colsel` 为 `API/04` 中的当前页面列串。这些取值来自现有环境，不是全局常量；现场若不同，需核实后调整配置。其余未启用条件为空字符串。

## 响应和错误

Transport 可解析 `text/plain` 中的 JSON；401/403、登录重定向或登录 HTML 归类为会话失效，其他 HTML 和无效 JSON 分开处理。公共 `ClientInfo` 的布尔字段只接受明确的布尔值，缺失不会补成 `true`。`IsLogin=false` 优先于业务失败；`Status=false` 或 `Result=false` 为业务失败。

`GetUserModel` 只返回给 UI 一个 `SessionSummary`。2026-09-24 现场正文已确认，约 115 KB，顶层为 `UserModel`、`UserMenu`、`ClientInfo`。已登录时 `ClientInfo.IsLogin=true`、`Status=true`，但 `Result=false`、`Message=null`。因此本接口不把 `Result=false` 当成登录失败；`Status=false` 仍是业务失败。展示名优先取 `UserModel.Name`，为空时用 `user_name`；`userId` 只接受 `UserModel.user_id` 的 GUID。`SessionId`、`UserMenu` 和其余用户字段不进入摘要，也不保留在内存。未知结构仍返回 `AUTH_UNKNOWN`，诊断只有脱敏后的顶层字段名。

无登录会话时，该接口返回 HTTP 200、`text/plain`，正文是约 70 字节的 HTML：`出错了!`。这被归为会话失效，不是网关故障，也不是通用 HTML 错误。

`GetSearchFiles` 要求明确的登录与成功信号，读取 `TableRows` 数组或 `null`，把字符串 `TableRowsCount` 校验为安全的非负整数。每条记录至少需要 `file_id`、`file_name`；可选映射包括 `file_desc`、`case_volume`、`app_no`、`customer_name`、`post_date`、`file_status` 等。输出为 `FileSearchResult { items, total, pageIndex, pageSize, totalPages }`，日期保留服务端原始字符串，不推测时区。**只有有效成功响应且总数为 0 时，UI 才显示空结果。**

错误码：`INVALID_ORIGIN`、`INVALID_QUERY`、`NETWORK_ERROR`、`REQUEST_TIMEOUT`、`HTTP_ERROR`、`SESSION_EXPIRED`、`AUTH_UNKNOWN`、`BUSINESS_ERROR`、`INVALID_RESPONSE`、`UNEXPECTED_HTML`、`REQUEST_ABORTED`。`ApiError` 仅携带码、简短信息、可选 HTTP 状态与脱敏字段名；不含 Cookie、Token、原始响应或请求体。HTTP 502/503 不被误判为未登录。

## 2026-09-24 现场已确认

- 授权账号登录后，`GetUserModel` 结构如上；`Name` 为短字符串，`user_id` 为 GUID。
- 文档中的我方文号查询返回 HTTP 200，`TableRowsCount` 为两位数字字符串，`pageSize=20` 时第一页 20 条、第二页 4 条，`ClientInfo.Result=true`。
- 不存在的文号返回 `TableRowsCount="0"`、`TableRows=null`、`IsLogin=true`。
- 行内 `file_id`、`file_name` 以及卡片用到的可选字段是字符串；日期带尾部空格，标准化时 trim，不转换时区。行内另有未映射的数字字段（如 `sn`），不影响列表。
- 当前 `fileclass`、`case_type`、`is_pat`、`colsel` 在首页直接查询时被接受。
- 加载 `dist` 的 Chromium 中，Content Script 复用登录后的浏览器会话完成上述查询；清除该浏览器 Cookie 后再检测，浮窗显示登录已失效。

## 仍待现场补充

- 真实 HTTP 502/503 的页面文案。自动化已区分它们和未登录，但没有在生产网关上触发。
- 点击原网站退出按钮后的响应是否与无 Cookie 的 `出错了!` 相同。本次是在测试浏览器中清除 Cookie，没有点击原站退出。
- 真实首页上的 L2 扫描、拖拽和 `FileSearch.aspx` iframe 共存。这些在本地 E2E 通过，本次现场流程没有逐项再点。
