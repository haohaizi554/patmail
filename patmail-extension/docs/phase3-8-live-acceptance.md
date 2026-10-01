> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.8 真实 EASY 只读验收

状态：**PENDING**。

本机没有已授权的 EASY 浏览器会话。没有调用真实服务器，没有导出 Cookie，没有保存密码，没有试探未知写接口。Fixture 页面不算现场通过。

以下项目没有现场结果：

- `GetUserModel`、`GetSearchFiles`、`IPGetBasicData`、`LoadFileTypeByCaseType`、`LoadMailType`。
- 已有测试邮件读取和已有流程读取。
- operator GUID、真实文件 ID、客户、案件 ID、发文类型内部 ID、文件描述内部 ID。
- EASY 客户内部 GUID 的真实来源。页面输入的 GUID 不能充当来源。

`TreeType` 的含义仍未确认。唯一文本匹配只说明名称对应某个字典节点。`descriptionSelectability` 保持 `pending`，没有为了写入改成 `confirmed`。

仍为 `CONTRACT_PENDING` 的包括：`GetSearchFiles` 的验收构建、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit`。HTTP 200 和手工期望值都不会被写成 `EASY_UI_COMPARED`。
