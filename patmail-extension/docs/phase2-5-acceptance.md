# Phase 2.5 验收

日期：2026-09-26。不要用真实客户的正式发文试写接口。

## 自动化

- [x] 客户名称不一致时不会把未确认的那组绑上。
- [x] 同一配置下不同原始客户名称不会合并。
- [x] 重复描述映射使草稿 blocked，保存冲突不会覆盖原映射。
- [x] 选择、规则、用户或站点变化会改变指纹。
- [x] 合并创建参数的 ID 与名称数量、顺序一致，`mailstyle=1`。
- [x] 单发和缺少响应契约时不调用 `MailCustomer`。
- [x] 缺少 `objid` 或超时进入 UNKNOWN，同一预览不会再创建。
- [x] 创建成功后的读取失败仍保留 mail_id。
- [x] `GetMailInfo` 的邮件 ID 不一致或登录失效时读取失败。
- [x] 保存使用 `mail_type` 和 EASY `customer_id`。
- [x] 附件不一致或收件人缺少「名称(邮箱);」时不能保存。
- [x] 保存失败、保存超时、关联格式未核对时都不调用 `SaveMailRalteCaseFile`。
- [x] 关联后的重新读取不一致时进入 PARTIAL_FAILURE。
- [x] 未带 `confirmed: true` 的创建消息被拒绝。
- [x] 未登录时 `EasyRuntime.createEasyMail` 不发送 `MailCustomer`。
- [x] Phase 1 至 Phase 2.4 原有测试仍通过。

2026-09-26：`pnpm test` 13 个文件、102 项通过。`pnpm typecheck` 和 `pnpm build` 通过。

## 真实 EASY

以下全部未做。因此生产写开关保持关闭。

- [ ] 用授权测试记录登录并读取当前用户。
- [ ] 查询测试文件并生成本地草稿。
- [ ] 只读核对 `MailinfoInit`、`GetMailInfo`、`GetMailFile`、`GetMailCase`、`GetMailRule`、`GetCustomerContact`、`GetSignature`。
- [ ] 核对 `MailCustomer` 的真实响应正文和 `objid`。
- [ ] 核对单发 `mailstyle`。
- [ ] 核对 `SaveMailInfo` 的真实响应正文。
- [ ] 核对 `SaveMailRalteCaseFile` 非空 `file_ids` 的格式。
- [ ] 在明确确认后创建一封测试草稿、保存，并重新读取文件和内容。
- [ ] 确认没有重复创建。

Mock 通过不能记成真实 EASY 成功。
