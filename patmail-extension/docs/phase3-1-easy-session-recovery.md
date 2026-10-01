> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.1 EASY 会话恢复

`EasyConnectionContext` 增加 `connectionVersion` 和 `lastOperatorId`。

快照键是 `patmail.connection.snapshot.v1`，只保存：

- `easyOrigin`
- `easyTabId`
- `lastOperatorId`
- `connectionVersion`

不保存 Cookie、Token 或完整用户模型。

Service Worker 启动时 `restoreCandidate` 只恢复候选标签页，状态是 `pending`，`operatorId` 为空。已登录必须重新读取 `GetUserModel`，GUID 匹配后才进入该账号的业务数据。

`beginBind`、标签页刷新、离开站点和解绑都会增加 `connectionVersion`。`applySession` 只接受当前版本。过期的 `GetUserModel` 不能覆盖新的绑定。

用户从 A 变为 B 时，后台加载 B 的账号数据，前端替换 A 的客户、模板、规则和任务。B 的结果不会写入 A 的命名空间。

扩展页面上的保存任务、执行写入、规则保存、客户保存、转发和验收，会在提交前重新检测会话。版本或操作员已经变化时，写操作丢弃，不把旧请求写入新账号。消息发送失败只把会话标成待重新检测，不把仍打开的标签页当成已关闭。
