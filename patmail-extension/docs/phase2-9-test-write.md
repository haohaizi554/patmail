# Phase 2.9 受控测试写

日期：2026-09-26。

`TEST_WRITE` 与生产写开关是两件事。生产开关保持 false。测试写还要同时满足：

1. 操作员是已确认的 EASY GUID。
2. 只读验收清单的每一项最新记录都是 `PASS`。
3. 任务不是 `STALE`、`UNKNOWN` 或只读。
4. 客户 EASY GUID 已确认，并且在 `allowedCustomerIds` 里。
5. 文件编号全部在 `allowedFileIds` 里。已有邮件编号必须在 `allowedMailIds` 里。
6. 该写接口已有非 Mock 证据，等级不是 `UNKNOWN`。
7. 用户逐项确认。
8. Background 租约领取成功。
9. 检查点 `PREPARED` 落盘成功。
10. `markSent` 成功并且 `leaseVersion` 增加之后，才允许 fetch。

白名单来自 `TestExecutionScope`。文件名里出现“测试”不会自动放行。仓库里的 `CLOSED_TEST_SCOPE` 三个名单都是空的。

阶段分开执行：`MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`。完成一步不会自动进入下一步。`EndEmailFlowd`、审核和邮件发送本阶段不执行。

请求发出后如果响应丢失，结果是 `UNKNOWN`。界面说明该操作可能已经在 EASY 成功，PatMail 不会自动重试，只能只读核对。

`AuditEvent` 记录任务、子任务、执行编号、模式、阶段、Call、操作员摘要、是否发送、是否收到响应、是否回读，以及起止时间。不记录 Cookie、令牌、密码、正文和真实邮箱。

本环境没有放行的测试客户和测试文件，也没有现场 `PASS` 记录，所以没有执行真实 TEST WRITE。
