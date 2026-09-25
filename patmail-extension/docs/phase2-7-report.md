# Phase 2.7 报告

日期：2026-09-26。开发停在 Dry-run、任务模型和执行协调。没有打开生产写操作，也没有进入真实自动发文。

## 1. Phase 2.6 是否收口

是。重新规划、按节点过滤审核人、刷新时重读流程、页面刷新后的只读恢复都已落地。`UNKNOWN` 和已经发出的提交不能靠重新规划解锁。详见 `docs/phase2-6-closure.md`。

## 2. 任务模型

`AutomationTask` 绑定站点、用户、文件集合、客户配置和规则版本。`AutomationTaskItem` 按邮件分组独立记录状态。详见 `docs/phase2-7-task-model.md`。

## 3. 状态机

邮件、流程、任务是三层。任务状态包括 `DRY_RUN_COMPLETED`、`BLOCKED`、`STALE`、`UNKNOWN` 等。流程和邮件的迁移表在收口文档里。

## 4. 副作用

阶段目录标明无副作用、只读或写入。五个写阶段是创建、保存、文件关联、流程提交、审核执行。当前执行器对写阶段返回阻塞，不发请求。

## 5. Dry-run

复用 `planDrafts` 和 `planMailGroups`。不调用 `MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd`。缺客户、缺描述、缺映射、缺收件人时是 `BLOCKED`。

## 6. 跨标签页协调

共享锁下同一指纹只有一个所有者。租约在存储里，Service Worker 重启后可恢复。`chrome.storage` 的读改写不是事务；两把独立锁仍可能都领取成功。`crossTabCreateAtomic` 保持 false。详见 `docs/phase2-7-coordinator.md`。

## 7. 请求前持久化

`markRequestSent` 在写请求前写入检查点。生产路径在门禁未通过时不写这个标记。

## 8. UNKNOWN

创建未知则停止。保存、关联、流程提交改为重读对应接口。审核保持 pending。已完成的子任务不会被删掉。

## 9. 契约证据

只读流程接口里，`GetFlowInfo`、`GetFlowHistory`、`GetUrgencyList`、`GetFlowLastStatus` 有已捕获响应。`GetFlowSubmit` 的 502 和空响应不是成功。写接口响应仍未捕获。详见 `docs/phase2-7-contract-evidence.md`。

## 10. 测试与真实环境

| 命令 | 结果 |
|---|---|
| `pnpm test` | 15 个文件，121 项通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm test:e2e` | 13 项通过。需清空本机 HTTP 代理；代理开启时夹具页连接超时 |

Mock 通过。本地浏览器夹具通过。真实 EASY 只读未做。真实 EASY 写操作未验证。

`EASY_MAIL_WRITES_ENABLED` 和 `WORKFLOW_WRITES_ENABLED` 仍是 false。

## Definition of Done

- [x] Phase 2.6 P0 收口
- [x] 工作流可重新规划
- [x] 审核人按节点过滤
- [x] 流程刷新重读真实状态字段
- [x] 页面刷新后只读恢复
- [x] AutomationTask 与 TaskItem
- [x] 任务状态机与阶段目录
- [x] TaskBuilder、TaskValidator、Dry-run
- [x] 执行协调器、检查点、UNKNOWN
- [x] 跨标签页并发测试，并保留未证明互斥的结论
- [x] 已有邮件只读诊断
- [x] 接口契约目录
- [x] 任务管理 UI，没有未验证写操作按钮
- [x] 结构化日志和脱敏导出
- [x] Phase 1 至 Phase 2.6 测试仍在
- [x] 类型检查、构建、本地 e2e
- [x] 真实写操作保持关闭
- [x] 文档

真实 EASY 只读和写接口核对留在授权环境，本次没有做。
