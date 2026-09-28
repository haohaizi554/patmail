# 案件要求表文本资产

日期：2026-09-28。

发文页下方那张表（序号、要求类型、标题、描述）是人在原网站维护的案件要求。表格规则会落后，不能拿来代替这张表。这张表的句子也不交给程序直接解释。后面的工作流是：把包括这张表在内的文本字段交给 agent，由 agent 格式化并仲裁出决策。当前只做一件事：稳定拿到这张表的原文。

## 什么时候能读到

原站是在打开 `Forms/mail/mail.aspx` 时发出这个请求的。抓包见 [API/09-期限监控.md](../../API/09-期限监控.md) 第 4 节。

请求本身认的是案件编号 `case_id`，不是发文编号 `mail_id`。插件不刮页面上的表格，而是用当前登录会话重放同一条 HTTP。发文页不必正开在眼前，但必须已经知道这个案件的编号。编号来自该发文关联的案件（`GetMailCase` 的 `case_id`）。一封发文挂了多件案子时，每件案子各读一次。

还没有核对过的两点：

- 离开邮件页、改掉 `log_pagename` 之后，服务器是否仍返回同一张表。所以请求仍固定 `log_pagename=mail.aspx`，和抓包一致。
- 响应正文没有跟页面逐字段核对。列表外壳先按同页的 `GetMailCase`、`GetMailFile` 理解：顶层 `TableRows` 和字符串形式的 `TableRowsCount`。对不上时不当成「没有要求」。

## 请求

`POST /AjaxServers/PatentAction.ashx`

| 参数 | 值 |
|---|---|
| Call | `GetDemandBuCaseid` |
| case_id | 案件 GUID |
| pageIndex | 从 1 开始 |
| pageSize | `10` |
| searchKey | 空字符串 |
| _PK | `demand_id` |
| colsel | `;demand_type;demand_name;demand_desc;` |
| log_pagename | `mail.aspx` |

页面三列对应：

| 画面 | 字段 |
|---|---|
| 要求类型 | `demand_type` |
| 标题 | `demand_name` |
| 描述 | `demand_desc` |

`TableRows` 缺失或为 `null` 时，结果是未知，不是空表。某一页中途失败时，已经读到的行保留，并标明文本不完整。原文不做摘要、不去 HTML、不合并同义句。

拼好的文本一行一条，顺序与接口返回一致：

```text
1. 要求类型：答复要求
标题：尽量不要超过5页
描述：转给案件流程时先联系客户。
```

## 插件里的入口

只读。不创建发文，不改要求，不把文本送进 agent。

- 传输名 `caseDemand`，白名单固定到上面的 Handler 和 Call。
- `loadCaseDemandText(caseId, post)` 翻页并产出 `{ caseId, rows, text, complete, message }`。
- 内容脚本消息 `READ_CASE_DEMANDS`，负载只有 `{ caseId }`。返回 `CASE_DEMAND_RESULT`。

`complete === false` 时，`text` 只覆盖已读到的页，不能交给 agent 当作全表。

## 现在不做

- 不在界面上展示这张表。
- 不把要求类型映射成发文动作。
- 不把联系人侧栏和这张表一起送出。联系人仍是另一组尚未接全的请求。
- 不在响应正文核对完成之前，把 `TableRows === null` 写成「这个案件没有要求」。
