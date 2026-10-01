> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.7 执行协调

日期：2026-09-26。

## 目标

同一个 `origin + operatorId + taskFingerprint` 在共享锁下只有一个活动所有者。租约保存在存储，不保存在 Service Worker 内存。记录包含 `executionId`、`taskFingerprint`、`owner`、`status`、`requestSent`、`easyMailId`、`startedAt`、`updatedAt`、`lastCheckpoint`、`origin`、`operatorId`。不保存 Cookie。

## 实现

`ExecutionCoordinator` 接收存储区、锁和所有者 ID。

- 共享锁：第二个相同指纹的 `claim` 被拒绝。不同指纹可以同时存在。
- `navigator.locks` 可用时用 Web Locks。不可用时退回进程内锁。
- Background 用同一个类处理 `CLAIM_EXECUTION` 和 `RECOVER_EXECUTION`。所有者 ID 在 Service Worker 启动时生成。重启后的恢复只读存储。
- `requestSent` 的 `RUNNING` 在恢复时改成 `UNKNOWN`。之后同一指纹不能再领取。

`chrome.storage.local` 的读取、修改、写回不是跨标签页事务。两个各自持有进程内锁的实例，如果写回互相覆盖，测试证明两边都会领取成功。

因此 `CROSS_TAB_WRITE_EXCLUSION_PROVEN` 保持 false。`WORKFLOW_CONTRACT.crossTabCreateAtomic` 保持 false。没有为了验收把它改成 true。

## 剩余限制

共享锁能证明“同一把锁下不会有两个所有者”。它不能证明两个标签页绕过 Background、各自使用自己的锁和延迟写回时仍然互斥。生产写操作继续关闭。

后续可以再结合 EASY 服务端唯一约束、业务幂等标识或创建后查询。在那之前，协调器只阻止已记录的重复领取，不作为打开写开关的依据。
