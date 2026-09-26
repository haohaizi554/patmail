# Phase 2.9 契约证据库

日期：2026-09-26。

`StoredEvidence` 记录 handler、Call、Origin、操作员摘要、请求形状、响应形状、HTTP 状态、业务成功、回读接口、回读是否一致、来源、等级、时间和样本摘要。

来源是 `LIVE`、`CAPTURED_HAR`、`PAGE_SCRIPT` 或 `MOCK`。等级是 `UNKNOWN`、`REQUEST_OBSERVED`、`RESPONSE_OBSERVED`、`READBACK_VERIFIED`。

Mock 一律是 `UNKNOWN`，不能变成生产证据。`businessSuccess` 为 false 时到不了 `RESPONSE_OBSERVED`。回读不一致时到不了 `READBACK_VERIFIED`。

## 验证器

`ContractVerifierRegistry` 为 `MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd` 分别提供请求字段检查、响应判断、回读计划和回读比较。

HTTP 2xx 且响应非空，在真实成功条件捕获之前仍然返回“不能判断业务成功”。`Status === false`、空响应、502 和 503 明确算失败。验证器不会根据猜测把 `objid` 或 `Status=true` 当成已经回读核验。

证据写入扩展源的 IndexedDB `patmail-evidence`。
