> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.8 报告

日期：2026-09-26。开发停在任务持久化、阶段计划和契约核验工具。没有打开生产写操作，也没有进入真实自动发文。

## 1. taskId 碰撞

已修复。任务编号是 `crypto.randomUUID()`。业务指纹是规范化内容的 SHA-256。相同输入的两次 `buildTask` 编号不同、指纹相同。不同文件集合的指纹不同。旧的 `slice(0, 24)` 编号不再生成。

## 2. 旧任务迁移

非 UUID 编号换成新 UUID，旧编号写入 `legacyTaskId` 和迁移记录。`easyMailId` 保留。`UNKNOWN` 和未核验的 `requestSent` 迁移后仍是只读 `UNKNOWN`。已是 UUID 的任务不会再次换号。无法识别的对象留在 `opaque`，不删除。

## 3. 指纹

摘要包含站点、操作员、按文件编号排序的完整文件集合、客户绑定、文件描述、发文方式、类型映射、收件人、标题、正文、签名内容、规则版本和查询模板版本。规则正文变化会改变摘要，不依赖 revision 单独递增。文件顺序变化不改变摘要。

## 4. 持久化

任务读写经过 `AutomationTaskService`。页面使用 IndexedDB `patmail-automation-tasks`，在一次 readwrite 事务中提交。保存失败时面板显示“未保存”。重新打开时按站点和用户重新校验并列出历史计划。

## 5. 并发边界

执行账本在同一次 IndexedDB 事务里保证同一指纹只有一个活动所有者。Background 重启后，已发请求且仍在运行的租约变为 `UNKNOWN`，不能再次领取创建。`chrome.storage` 读改写仍然不是事务，`CROSS_TAB_WRITE_EXCLUSION_PROVEN` 保持 false。本地互斥不等于 EASY 服务端恰好一次。页面任务库和扩展租约库不在同一个源。

## 6. 检查点

`CheckpointService` 按子任务落盘。写请求前必须成功写入 `requestSent`。落盘失败则返回原任务，请求不会发出。发出之后不能自动重试创建。

## 7. Dry-run

`AutomationStagePlan` 列出每个子任务的阶段、副作用、前置条件、能否执行、阻塞、是否需要确认和契约状态。写阶段不可执行。Mock Transport 的调用次数为 0。

## 8. 契约证据

脱敏分析会去掉 Cookie、令牌、密码和邮箱。证据等级为 `UNKNOWN`、`REQUEST_OBSERVED`、`RESPONSE_OBSERVED`、`READBACK_VERIFIED`。502、空响应、只有请求、回读不一致，以及 Mock，都不能升到回读核验。静态目录的 `responseCaptured` 不能打开写门禁。本阶段没有新的生产回读样本。

## 9. 未完成的现场验证

真实 EASY 只读验收为 `PENDING`。当前环境没有已登录会话。`GetUserModel`、文件查询、字典、邮件读取和流程读取都没有在本环境执行。写接口契约未验证。浮动面板没有对着真实 EASY 点击。

## 10. 生产写门禁

`EASY_MAIL_WRITES_ENABLED` 为 false。`WORKFLOW_WRITES_ENABLED` 为 false。`productionWriteAllowed()` 为 false。`crossTabCreateAtomic` 为 false。本阶段没有发送正式客户邮件，也没有提交流程或审核。

## 测试

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile --ignore-workspace` | 锁文件未改。依赖已链接 |
| `pnpm test` | 16 个文件，126 项通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm test:e2e` | 13 项通过。夹具拦截 `http://183.36.43.66:88`，不访问真实服务器。本机 HTTP 代理已清空后再跑 |

区分：

| 类别 | 状态 |
|---|---|
| 单元测试 | 通过，126 项 |
| 浏览器夹具 | 通过，13 项 |
| 真实 EASY 只读 | PENDING |
| 真实写接口契约 | 未验证 |
| 真实写操作 | 未执行 |

## Definition of Done

- [x] taskId 碰撞修复
- [x] 任务指纹改为规范化内容摘要
- [x] 配置实际内容变化可检测
- [x] 旧任务不会被错误覆盖
- [x] TaskRepository 经 AutomationTaskService 接入 UI
- [x] 页面刷新后可按站点和用户恢复任务列表
- [x] 多客户任务正确展示
- [x] TaskItem 独立状态与检查点
- [x] UNKNOWN 不被历史裁剪淘汰
- [x] 执行记录使用 IndexedDB readwrite 事务
- [x] Background 重启后已发请求进入 UNKNOWN
- [x] Checkpoint 写前落盘，失败则不发请求
- [x] Dry-run 阶段计划
- [x] Dry-run 零写请求由 Transport 调用次数证明
- [x] 真实 EASY 只读验收工具完成，现场结果 PENDING
- [x] 契约脱敏分析工具完成
- [x] 接口证据状态不能靠改静态目录伪造
- [x] 生产写操作继续关闭
- [x] 原有测试保留
- [x] 类型检查、构建、夹具 e2e 通过
- [x] 文档

现场只读和写接口回读留在已登录环境。本次没有把它们记为通过。
