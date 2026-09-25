# Phase 2.8 真实 EASY 验收

日期：2026-09-26。

## 现场状态

`LIVE_EASY_ACCEPTANCE.status` 为 `PENDING`。

原因：当前开发环境没有已登录的 EASY 会话。本文件不把任何只读接口记为现场通过，也不记录写接口契约已验证。

`classifyReadonlyCall` 供现场记录使用。写接口调用直接判失败。502 与 503 判失败。其它非 2xx 判失败。即使返回 2xx，函数说明也写明“这仍不是现场通过记录”。通过与否必须来自授权会话上的实际响应，不能由单元测试改写 `PENDING`。

## 只读清单

到已登录环境后，按下面顺序核对，并与原网站同一条记录对照。不要用 Mock 节点代替真实候选人。审核人只比较 GUID。

1. `GetUserModel`：得到稳定的操作员 GUID。会话字符串不算已确认身份。
2. `GetSearchFiles`：核对 `fileId`、`fileName`、`fileDescription`、客户、`caseId`。确认草稿预览用的是这条响应里的字段。
3. `IPGetBasicData`、`GetFlowdirection`、`LoadMailType`：核对文件描述 GUID、发文类型 GUID、客户身份。
4. 在已有邮件上只读 `GetMailInfo`、`GetMailFile`、`GetMailCase`、`GetMailRule`、`GetCustomerContact`、`GetSignature`。
5. 只读 `GetFlowInfo`、`GetFlowHistory`、`GetUrgencyList`、`GetFlowSubmit`、`GetFlowLastStatus`。记录真实下一节点、审核人 GUID、流程版本和审核历史。`GetFlowSubmit` 返回 502 时记失败。

## 写接口

本阶段不执行 `MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd`。

若以后在授权测试记录上通过原网站操作并导出网络记录，先在本地脱敏，再交给 `analyzeExchange`。不要把 Cookie、Authorization、密码、令牌、真实邮箱或完整正文放进样本。

## 写操作仍然关闭

即使只读清单以后全部通过，正式写操作仍要同时满足：当前用户身份可靠、任务快照有效、客户身份可靠、发文类型映射正确、收件人明确、写接口达到回读核验、跨标签页执行所有权已验证、请求前检查点已落盘、写入结果有回读、用户明确确认。任一不满足则保持阻塞。

本阶段这些条件没有同时满足。产品不会自动发送正式客户邮件。
