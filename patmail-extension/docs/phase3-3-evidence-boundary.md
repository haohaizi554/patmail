# Phase 3.3 验收证据边界

验收记录增加 `evidenceSource`：

- `MANUAL_EXPECTATION`
- `EASY_UI_OBSERVED`
- `API_RESPONSE`
- `HAR_CAPTURE`
- `MOCK`

用户手工填写的 `key=value` 只说明 `API_RESPONSE` 与 `MANUAL_EXPECTATION` 一致。匹配成功时 `matchedWithUi` 仍为 `false`，`evidenceLevel` 不会变成 `UI_COMPARED`。页面显示“未与原网页对照”和“手工期望”。

`UI_COMPARED` 只在 `evidenceSource` 为 `EASY_UI_OBSERVED` 且实际对照过原网页字段时使用。当前只读验收没有独立读取原网页业务字段，因此不会自动标成原网页对照。

Mock 仍是 `BLOCKED`，不能作为现场证据。HTTP 200 且 `ClientInfo.Status=false` 仍是 `FAIL`。502/503 仍是 `FAIL`。

`GetSearchFiles`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 继续 `CONTRACT_PENDING`。没有为了增加通过数填写猜测参数。
