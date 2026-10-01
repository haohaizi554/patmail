> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 账号竞态与连接快照

## 响应代际

`useWorkspace.call` 为每次请求分配 `requestId`。响应提交前走 `canCommitWorkspaceResponse`：

- `requestId` 必须仍是最新一次请求。
- 已登录响应必须带 origin 和 operatorId，不能只看 authenticated。
- 响应 origin 必须等于请求发出时的 origin。

账号 A 的 load 若在切换到 B 之后才返回，A 的 `requestId` 已过期，不会写入 B 的 connection、客户、模板、规则或任务。

`accountEpoch` 在 operator 或 `connectionVersion` 变化时递增。客户表单、规则导入文本、文件选择、模板编辑和邮件草稿会在用户变化后清掉。

## 旧表单

编辑开始时记下当时的 `ExpectedAccountScope`。切到账号 B 之后，这条范围与 Background 重新核验的会话不一致，`mutationGuard` 拒绝，不会把 A 的客户写进 B 的 `patmail.query.v1` 分区。

## 快照回路

`persistConnection` 用 `sameConnectionSnapshot` 比较 origin、tab、lastOperatorId、connectionVersion。相同则不写 `patmail.connection.snapshot.v1`。

完整页面只在查询/规则存储键变化时重新 `load`。快照只有在身份或绑定版本真正变化时才 `refreshSession`。已有请求在飞时，存储监听不再另起一次账号刷新。会话检测时间不在快照里，因此不会靠固定 debounce 把回路藏起来。
