# EASY API Runtime（Phase 2.1）

这里只实现两个只读操作：`Login.ashx/GetUserModel` 和 `CaseInfo.ashx/GetSearchFiles`。`client.ts` 管理会话门控和取消；`transport.ts` 固定 Origin、Handler、Call、POST 与 form-urlencoded；`file-search-params.ts` 把简化查询转换为已记录的 117 项参数（实际提交 116 项，省略旧前端 `_doneCallback`）；`file-search-normalizer.ts` 把已校验的响应转换为浮窗业务模型。

请求由 Content Script 在 EASY 同源页面发起，`credentials: 'same-origin'` 复用浏览器会话。模块不读取 Cookie，也不提供任意 URL/Call 的请求接口。当前租户配置见 `config.ts`，现场变化须在此处核实；不得把内置 ID 当作所有租户的通用值。

`GetUserModel` 的现场响应里 `Result` 可以为 false，登录判断以 `IsLogin` 和 `Status` 为准。摘要只保留已确认的显示名和用户 ID。协议见 `docs/phase2-1-api-contract.md`。
