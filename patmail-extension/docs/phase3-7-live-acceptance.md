# Phase 3.7 真实 EASY 只读验收

状态：**PENDING**。

本机没有已授权的 EASY 浏览器会话。没有调用真实服务器，没有导出 Cookie，没有保存账号密码，没有用正式客户发文记录试探写接口。

因此以下项目都没有现场结果：

- 稳定 operator GUID 和当前会话。
- 真实 `file_id`、客户归属、文件描述、案件 ID、查询条件和分页。
- 文件描述内部 ID、发文类型内部 ID，以及与原网页 UI 的对照。
- 已有测试邮件的邮件 ID、客户、案件和文件关联。
- 当前流程节点、审核历史、当前处理人和下一节点候选。

Fixture 页面 `http://183.36.43.66:88` 只用于本地浏览器测试，不算现场通过。

仍未确认、保持 `CONTRACT_PENDING` 的接口包括：`GetSearchFiles` 的验收构建、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit`。产品查询仍使用现有 `buildGetSearchFilesParams`。`TreeType` 的业务含义也未确认，不能把字典文本匹配写成发文参数已验证。
