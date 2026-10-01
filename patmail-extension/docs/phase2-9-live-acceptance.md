> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.9 现场只读验收

日期：2026-09-26。

`LiveEasyAcceptanceRunner` 只接受白名单中的只读 Call：

`GetUserModel`、`GetSearchFiles`、`IPGetBasicData`、`GetFlowdirection`、`LoadFileTypeByCaseType`、`LoadMailType`、`GetMailInfo`、`GetMailFile`、`GetMailCase`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowInfo`、`GetFlowHistory`、`GetUrgencyList`、`GetFlowSubmit`、`GetFlowLastStatus`。

写接口在调用传输之前就被拒绝。传输标记为 Mock 时不发起调用，结果是 `BLOCKED`。502 / 503、登录失效、对照字段不一致都是 `FAIL`。没有对照字段时，除了已经解析出操作员 GUID 的 `GetUserModel`，其余接口是 `BLOCKED`，不会被记成通过。

`LiveAcceptanceRecord` 保存调用、时间、HTTP 状态、业务状态、请求/响应形状、对照字段名、结论、原因和证据摘要。不保存 Cookie、令牌、密码、正文和邮箱。

记录经 `SAVE_ACCEPTANCE` 写入 Background 证据库。`LiveAcceptancePanel` 可以执行只读验收、重试单项、查看脱敏形状和导出报告。

## 本环境

没有已登录的 EASY 会话，所以没有一条现场记录被标成通过。静态清单 `LIVE_EASY_ACCEPTANCE.status` 保持 `PENDING`。
