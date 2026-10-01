> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.5 字段映射

日期：2026-09-26。`adaptMailDraft` 生成差异和待保存字段。某一行来源未知时，`canSave` 为假，该字段不会用空字符串提交。

| 保存字段 | EASY 原值 | PatMail 计划 | 拟保存 |
|---|---|---|---|
| mail_id | 创建得到的 `objid` | 无 | 创建得到的 GUID |
| mail_type | `GetMailInfo.mail_type_id` | 本地映射的发文类型 GUID | PatMail GUID。参数名不是 `mailtype` |
| customer_id | `GetMailInfo.customer_id` | 只在差异里显示本地配置 ID | EASY GUID。配置 ID 不写入 |
| mail_to / mail_cc | `mail_to` / `mail_cc` | 本地邮箱 | 能在 `GetCustomerContact` 里对上显示名时写成 `名称(邮箱);` |
| mail_subject / mail_body | 邮件行原主题和正文 | 本地标题和正文 | PatMail 文本。签名随正文，不另设保存字段 |
| mailset_id、mail_bcc、is_zip、zip_pwd、renamezip、reply_date、proc_ids、express_id、message_id、subject_desc、mail_tags、finish_ctrl_proc | `GetMailInfo` 里同名或 `rename_zip` | 不改写 | 原样保留。键不存在则整次保存停止 |
| 附件 | `GetMailFile` | 计划中的文件 ID | 集合不一致时禁止保存 |
| 案件 | `GetMailCase` | 查询行上的文号 | 只展示，不另写案件列表 |
| 签名 | `GetSignature` | 当前操作员签名 | 只展示 |

`message_id` 出现在保存请求里，但没有出现在已核对的 `GetMailInfo` 字段清单中。读到这个键才保留它的值；读不到就停止保存，而不是提交空字符串。

差异表在执行面板里显示字段名、EASY 原值、PatMail 计划值和拟保存值。
