# Phase 3.3 账号事务

读取和保存开始时冻结 `AccountContextSnapshot`：

- `easyOrigin`
- `operatorId`
- `easyTabId`
- `connectionVersion`

异步读取结束后再次核对当前连接。不一致时返回 `contextError: STALE_CONTEXT`，客户、模板、规则和任务列表为空，不把账号 A 的数据和账号 B 的已登录连接拼在一起。

`mutationGuard` 返回这份冻结快照。随后的保存使用冻结后的来源和操作员。提交前如果账号变了，拒绝写入。写入已经落到原账号存储键时，结果仍记在原账号上，不会改写成新账号的操作。

前端把请求分成三类：

- `connectionEpoch`：换账号后，旧请求全部失效。
- `readRequestId`：只读刷新只接受同一账号里最新的一次。
- `mutationId`：同账号的保存回执不会因为后面的只读刷新被丢弃。

`chrome.storage.onChanged` 在已有请求未完成时先合并成一次待刷新，请求结束后再读取。页面重新可见时也会补读当前账号。被新的会话检查取消的 `REQUEST_ABORTED` 不会把已登录连接清掉。
