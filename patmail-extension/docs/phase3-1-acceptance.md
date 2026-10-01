> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.1 接口验收

`ReadonlyAcceptanceContext` 只包含 `caseTypeId`、`mailId`、`flowType`、`expectedFields`。没有开放任意 Handler 或 Call。

缺少参数时页面和后台都记 `BLOCKED`，不发送请求：

- `GetMailInfo` 以及邮件读接口需要邮件 GUID
- `LoadFileTypeByCaseType` 需要案件类型 GUID
- `GetFlowInfo`、`GetFlowHistory`、`GetFlowSubmit`、`GetFlowLastStatus` 需要邮件 GUID 和流程类型

HTTP 200 本身不是通过。没有对照字段时结果是 `BLOCKED`，并标明未与原网页对照。`GetUserModel` 能确认操作员 GUID，但 `matchedWithUi` 仍为 false，证据等级不升级。HTTP 502/503 记 `FAIL`。

内容脚本运行在 HTTP 的 EASY 页面上时没有 `crypto.randomUUID`。验收记录 ID 会改用 `getRandomValues`。正式记录仍由后台根据探针重新计算。

工作流页使用已有的只读 `ReadWorkflow`，必须先提供邮件 ID，不默认提交。
