# Phase 2.5 邮件接口契约

日期：2026-09-26。参数以 `API/07-发文与邮件.md`、`API/09-期限监控.md` 和 `HAR/跳转到发文`、`HAR/提交发文（要获取客户）` 为准。响应正文未保存的写接口，生产环境不调用。

## MailCustomer

`POST /AjaxServers/Notice.ashx`

| 参数 | 已确认内容 |
|---|---|
| Call | `MailCustomer` |
| _file_ids | 文件 GUID，分号分隔 |
| _file_names | 文件名，分号分隔，段数和顺序与 ID 一致 |
| mailstyle | 同客户合并发文是 `1` |
| mailtype | 发文类型 GUID |
| log_pagename | `FileSearchMail.aspx` |

页面成功条件是响应里的 `objid`，随后打开 `mail.aspx?objid=`。本次抓包响应 234 字节，正文没有保存。运行时把缺少 `objid`、无法解析或超时视为 `UNKNOWN`，不自动再调 `MailCustomer`。

单个来文的 `mailstyle` 没有在抓包里出现。这个分支不能创建。

`LimitMailCustomer` 不属于本阶段。

## 保存前的只读请求

都在 `POST /AjaxServers/Mail.ashx`，`log_pagename=mail.aspx`。

| Call | 已确认参数 | 已确认响应 |
|---|---|---|
| MailinfoInit | `mail_id`；`case_id`、`proc_id`、`file_ids`、`customer_id` 在已核对请求里为空 | `mailsettinglist` 可带 `mailset_id`。客户以 `GetMailInfo` 为准 |
| GetMailInfo | `mail_id` | `MailInfo` 数组。`mail_id` 必须与创建结果一致 |
| GetSignature | `mailset_id` | `Signature[].signature_content`。没有 GUID 形式的 `mailset_id` 时不调用，签名保持未知 |
| GetMailRule | `mail_id`、`customer_id`、`mail_type_id`、空的 `case_id` 和 `proc_id`、`mail_type` | `mail_type` 是显示名。页面读 `subject.subject` |
| GetCustomerContact | `customer_id`、`mail_id` | `CustomerContact[].contact_name`、`email` |
| GetMailFile | `pageIndex`、`pageSize=5`、`_PK=file_id`、抓包中的 `colsel` | `TableRows[].file_id`、`file_name`。`TableRows=null` 视为未知，不当成空列表 |
| GetMailCase | `pageSize=100`、`_PK=mail_case_id`、抓包中的 `colsel` | `TableRows[].case_id`、`case_volume` |

`customer_id` 只使用 `GetMailInfo` 读到的 GUID。PatMail 客户配置 ID 不能填进这些参数。

## SaveMailInfo

`POST /AjaxServers/Mail.ashx`，`Call=SaveMailInfo`，`log_pagename=mail.aspx`。

已观察到的字段：`mail_id`、`mail_type`、`customer_id`、`mailset_id`、`mail_to`、`mail_cc`、`mail_bcc`、`mail_subject`、`mail_body`、`is_zip`、`zip_pwd`、`renamezip`、`reply_date`、`proc_ids`、`express_id`、`message_id`、`subject_desc`、`mail_tags`、`finish_ctrl_proc`。

创建用 `mailtype`。保存用 `mail_type`。请求里的压缩包键是 `renamezip`，`GetMailInfo` 返回的是 `rename_zip`。

页面成功回调看 `ClientInfo.Status`。响应 187 字节，正文没有保存。`Status=false` 记为保存失败，不继续关联文件。超时或无法解析记为 `UNKNOWN`，不自动重试，也不关联文件。

收件人沿用抓包格式 `名称(邮箱);`。联系人里没有对应显示名时不改成裸邮箱。

## SaveMailRalteCaseFile

`Call=SaveMailRalteCaseFile`，参数名是 `file_ids`、`mail_id`、`log_pagename`。只在 `SaveMailInfo` 已得到明确成功之后调用。

抓包里的 `file_ids` 是空字符串。非空 ID 的分隔格式没有核对，生产门禁返回 `null`，因此不会发送这个请求。测试门禁可以显式注入分号，用来验证顺序和复核，不把分号写成已确认契约。

关联是否完成只看之后的 `GetMailFile`。HTTP 200 或 `Status=true` 都不单独当成成功。

## 明确不调用

`FlowSubmit`、`EndEmailFlowd`、`ApproveWorkflow`，以及发送邮件。
