# Agent 真实 EASY 只读联调

模式：`READ_ONLY_AUTO`。生产写开关保持关闭。登录用原站表单提交，账号密码不写入仓库、脚本或证据。

## 本次执行

命令：`pnpm live:readonly`。

隔离 Chrome 配置加载当前 `dist`，打开 `http://183.36.43.66:88/` 和扩展 `app.html`。脚本在登录页填入环境变量里的账号密码并点击登录，没有读取或导出 Cookie。会话结果：`AUTHENTICATED`。观察到的写请求：0。

查询文号使用此前现场核对过的 `PA2622582CND-YS`。没有猜测邮件 ID。

| 接口 | HTTP | 业务状态 | 提取字段 | UI 对照 |
| --- | --- | --- | --- | --- |
| GetUserModel | 200 | PASS | 已登录，展示名与页面可见文本一致 | 是 |
| IPGetBasicData | 200 | RESPONSE_OBSERVED | `CaseType` 7 项，首项标签「专利」 | 否，登录后首页没有该标签 |
| LoadFileTypeByCaseType | 200 | RESPONSE_OBSERVED | 节点 652。案件类型 ID 来自上一接口的既有适配 | 否 |
| LoadMailType | 200 | RESPONSE_OBSERVED | 发文类型 343 项，首项名称「发文不需要审批」 | 否 |
| GetSearchFiles | 200 | RESPONSE_OBSERVED | 总数 24。首条文件名、描述「实用新型专利证书(签章)」、客户「宁德时代」 | 否，没有驱动原站查询表格 |
| GetMailInfo / GetMailFile / GetMailCase | 0 | PENDING | 未发送 | 否 |
| GetFlowInfo / GetFlowHistory | 0 | PENDING | 未发送 | 否 |

脱敏记录在 `test-results/live-readonly-evidence.json`。

验收记录本身仍写「缺少与原网页对照的字段，不能记为通过」。上表的 `RESPONSE_OBSERVED` 只表示只读响应和字段提取，不表示原站 UI 已核对。

## 仍未确认

- 文件描述节点是否可作发文参数。`descriptionSelectability` 仍是 `pending`。`TreeType` 未解释。
- EASY 客户 GUID 没有来源。
- 发文类型首项只是响应里的第一行，不能当成已选发文类型。
- `GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 仍是 `CONTRACT_PENDING`，本次不发送。
- 已有邮件和流程接口需要已确认的 `mail_id`。本次没有猜测。

## 测试写入预检

`TEST_WRITE_STEP.execute` 为 false。没有调用 `MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd`。

| 项 | 当前值 |
| --- | --- |
| 测试客户 | 未从原站响应确认客户 GUID。文件查询看到客户名称「宁德时代」 |
| 测试文件 | 响应中的文件 ID，未写 |
| 预期邮件类型 | 未选定。响应首项名称仅作观察 |
| 拟调用写接口 | 上面五个 |
| 回读接口 | `GetMailInfo`、`GetMailFile`、`GetMailCase`、`GetFlowInfo`、`GetFlowHistory` |
| 回滚 | 没有发送写请求，不需要回滚 |

得到明确授权前不发送这些写请求。
