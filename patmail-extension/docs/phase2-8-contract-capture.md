> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.8 契约采集

日期：2026-09-26。

分析入口是 `analyzeExchange`。它接收已经在本地导出的单次交换，不要求上传 Cookie 或完整邮件正文。

## 保留的字段

`handler`、`Call`、`method`、`contentType`、`requestFieldNames`、`responseShape`、`businessSuccess`、`redirected`、`statusCode`、`followupReadEndpoint`、`source`、`observedAt`、`readbackMatched`。

请求体只保留字段名。响应只保留形状，例如 `object(objid)` 或 `empty`，不保留正文。

## 去掉的内容

字段名匹配 `cookie`、`authorization`、`password`、`token`、`mail_body`、`mail_subject`、`mail_to`、`mail_cc`、`email` 时，值替换为 `[redacted]`。文本中的邮箱地址替换为 `[redacted-email]`，`Bearer` 令牌替换为 `[redacted-token]`。

## 证据等级

| 等级 | 条件 |
|---|---|
| `UNKNOWN` | 没有可用的非 Mock 样本 |
| `REQUEST_OBSERVED` | 看到了请求字段，但业务成功条件不成立 |
| `RESPONSE_OBSERVED` | HTTP 2xx、响应非空、来源不是 Mock |
| `READBACK_VERIFIED` | 在上一档之上，回读结果与响应一致 |

以下情况不能升到 `READBACK_VERIFIED`：

- 状态码 502 或 503，包括此前的 `GetFlowSubmit` 502。
- 空响应。
- 只有请求、没有成功响应。
- 响应看起来成功，但 `readbackMatched` 不为 true。
- `source` 为 `mock`。Mock 样本会从等级计算中排除，不能升成生产证据。

`productionWriteAllowed()` 不读取 `CONTRACT_EVIDENCE.responseCaptured`，并且固定返回 false。直接改静态目录不能打开写门禁。

## 现场采集时要核对的写接口

这些接口本阶段只定义采集字段，不在产品里默认调用：

| 接口 | 要核对的内容 |
|---|---|
| `MailCustomer` | 合并与单个来文的 `mailstyle`，`_file_ids` 与 `_file_names` 的顺序，成功响应，`objid` 来源，创建后用哪个读接口回读邮件编号 |
| `SaveMailInfo` | 完整字段名、业务成功条件、失败响应、保存后 `GetMailInfo` 是否读到修改 |
| `SaveMailRalteCaseFile` | 非空 `file_ids` 的格式、调用时机、成功响应、`GetMailFile` 回读 |
| `GetFlowSubmit` | 正常响应中的 `Result`、下一节点、`user_list`、`list_id`、`user_list_id`、并行审核与全部审核。502 不是成功样本 |
| `FlowSubmit` | 请求参数、成功与失败响应、流程状态变化、`GetFlowInfo` / `GetFlowHistory` 回读 |
| `EndEmailFlowd` | 完整参数与响应。结束流程、审核通过、邮件实际发送是三件不同的事 |

当前仓库里的静态目录仍记录这些写接口响应未捕获。本阶段没有新的 `READBACK_VERIFIED` 生产样本。
