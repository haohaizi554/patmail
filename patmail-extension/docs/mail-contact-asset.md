> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# 发文页联系人文本资产

日期：2026-09-28。

发文页右侧那一列是各组联系人的姓名、角色和邮箱。PCT 表格里的收件人、抄送，以及以后 agent 对要求表的仲裁，都要能点到这些联系方式。期限监控页的「按表格追加联系人」会按列约定把邮箱追加进插件里的收件人和抄送，不覆盖加载发文时已经填上的地址，也不改原网站。

画面上的「品川-IP联系人」「第一发明人」这一类字，是某一行的角色，不是各自一条接口。角色来自 `contact_type_zh_cn`。分组才对应下面这些请求。抓包见 [API/09-期限监控.md](../../API/09-期限监控.md) 的「联系人与规则」。

## 什么时候能读到

这些请求在打开 `Forms/mail/mail.aspx` 时一起发出。插件用当前登录会话重放，不刮右侧那一列。发文页不必正开在眼前。

| 画面分组 | Call | 数据键 | 条件 | 已记录字段 |
|---|---|---|---|---|
| 最近联系人 | GetRecentContact | RecentContact | 无 | `cn_name`、`email` |
| 客户联系人 | GetCustomerContact | CustomerContact | `customer_id`、`mail_id` | `contact_name`、`email`、`contact_type_zh_cn` |
| 案件联系人 | GetCaseContact | CaseContact | `mail_id` | 与客户联系人相同 |
| 业务联系人 | GetSalesContact | SalesContact | `mail_id` | `cn_name`、`email` |
| IP 联系人 | GetPicsContact | PicsContact | `mail_id` | `cn_name`、`email` |
| 代理人 | GetCaseAgentContact | CaseAgentContact | `mail_id` | 这次抓包为 `null` |

客户联系人响应里还可以有 `Introducer`：`introducer`、`introducer_email`、`inside_introducer`、`inside_introducer_email`。

除最近联系人外，都要这封发文的 `mail_id`。客户联系人还要 `GetMailInfo` 上的客户编号，不能填插件本地的客户配置编号。没有发文时，案件联系人、IP 联系人、业务联系人、代理人和客户联系人都读不到。PCT 表格在发文还没生成时，仍然只能用表格里已经写下的联系人，不能用这组接口补。

`log_pagename` 固定 `mail.aspx`。离开邮件页之后服务器是否仍返回同一份名单，还没有核对。

名单键缺失时，这一组是未知，不当成没有联系人。键存在且值为 `null` 时，这一组是空的。代理人这次抓到的就是 `null`。行上多出来的字段先忽略，不把整组判失败。姓名和邮箱都空的行不进入文本。

## 文本

有人的分组才出现。顺序固定为最近联系人、客户联系人、案件联系人、业务联系人、IP 联系人、代理人，介绍人附在客户联系人之后。

```text
客户联系人
姜颖 <liy02@pcl.ac.cn>（第一发明人（技术联系人））

IP联系人
王金山 <wang@example.com>
```

`complete === false` 时，`text` 只含已经对上的分组，不能交给 agent 或 PCT 当成全套联系人。

## 插件里的入口

只读。全部走 `POST /AjaxServers/Mail.ashx`。

- 传输名：`getRecentContact`、`getCustomerContact`、`getCaseContact`、`getSalesContact`、`getPicsContact`、`getCaseAgentContact`。
- `loadMailContactText({ mailId, customerId }, post)` 产出 `{ mailId, customerId, rows, introducer, text, complete, message }`。
- 内容脚本消息 `READ_MAIL_CONTACTS`，负载 `{ mailId, customerId }`。没有编号时传空字符串。返回 `MAIL_CONTACT_RESULT`。

已有的发文读取仍只使用客户联系人里的姓名和邮箱，不改那条保存路径。

## 现在不做

- 不在界面上列出这六组。
- 不把角色自动填进 PCT 表的「第一客户联系人」或「客户联系人(IPR)」。
- 不在没有 `mail_id` 时用客户编号猜测案件联系人或 IP 联系人。
- 期限监控页按外部表格的一行追加。这一行是一个发文任务。打开这一行已经加载的发文后，用文号对上这一行：收件人追加「第一客户联系人」里角色含第一发明人的邮箱，抄送追加业务联系人（商务）和「客户联系人(IPR)」。地址记在这一行上。已有地址留在前面，同一邮箱不重复。对上多行时不改。
- 不向 EASY 提交发文。插件字段里的 `名称(邮箱);` 还要等发文保存那一步单独核对。
