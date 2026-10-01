> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.4 真实只读验收

本轮环境没有已授权的 EASY 登录会话。没有访问真实 EASY 服务器，也没有把 Fixture 记成现场通过。

现场步骤保持 **PENDING**：

1. 读取当前用户 GUID。
2. 查询一批已知测试文件。
3. 核对文件内部 ID。
4. 核对客户归属。
5. 核对文件描述。
6. 核对发文类型字典。
7. 读取一封已有测试邮件。
8. 核对邮件关联文件。
9. 读取流程当前节点。
10. 核对审核历史与当前办理人。

## 分层

验收记录增加 `acceptanceLayer`：

- 未通过的响应记 `HTTP_RESULT`。HTTP 200 且业务状态失败时不会记成业务通过。
- 手工 `expected` 与响应一致时记 `MANUAL_COMPARED`。
- 没有手工字段、只读结构通过时记 `BUSINESS_VALIDATED`。
- 手工期望不会自动变成 `EASY_UI_COMPARED`。
- Mock 不作为 LIVE 证据。

## 仍为 CONTRACT_PENDING 的接口

以下接口的验收 Builder 没有补猜测参数：

- `GetSearchFiles`
- `GetMailRule`
- `GetCustomerContact`
- `GetSignature`
- `GetFlowSubmit`

产品里的文件查询已经有单独的 `GetSearchFiles` 参数 Builder。验收表单没有收集那份完整查询，所以验收契约继续保持 `CONTRACT_PENDING`。
