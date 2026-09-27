# Phase 3.9 真实 EASY 只读验收

状态：**PENDING**。

本机没有已授权的 EASY 浏览器会话。没有调用真实服务器，没有导出 Cookie，没有保存密码，没有试探未知写接口。Fixture 页面不算现场通过。

以下项目没有现场结果：

- `GetUserModel`、`GetSearchFiles`、`IPGetBasicData`、`LoadFileTypeByCaseType`、`LoadMailType`。
- `GetMailInfo`、`GetMailFile`、`GetMailCase`、`GetFlowInfo`、`GetFlowHistory`。
- 真实文件 ID、文件名称、文件描述、实际客户、案件 ID、文件描述内部 GUID、发文类型内部 GUID。
- EASY 客户 GUID 的真实来源。页面输入的 GUID 不能充当来源。

`TreeType` 的含义仍未确认。唯一文本匹配只说明名称对应某个字典节点。`descriptionSelectability` 保持 `pending`。

仍为 `CONTRACT_PENDING` 的包括：`GetSearchFiles` 的验收构建、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit`。
