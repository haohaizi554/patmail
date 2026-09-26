# Phase 2.9 HAR 导入

日期：2026-09-26。

`importHar` 读取用户在原网站操作后导出的 HAR。

它只保留目标 Origin，并且只保留只读白名单和五个写接口 Call。其他 Call 和其他 Origin 被忽略。

导入时丢掉这些内容：Cookie、Set-Cookie、Authorization、密码、令牌、邮件正文、收件人邮箱。保留路径、Call、方法、内容类型、非敏感字段名、响应形状、HTTP 状态和调用顺序。

写接口会带上对应的回读 Call 名称，例如 `MailCustomer` 对应 `GetMailInfo`。导入本身不把样本升到 `READBACK_VERIFIED`，因为业务成功条件还没有被现场回读确认。
