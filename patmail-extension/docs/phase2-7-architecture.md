# Phase 2.7 架构

日期：2026-09-26。

本阶段把已有查询、分组、草稿、邮件执行和工作流模块收成一个可恢复的任务层。运行路线仍是 Chrome Extension、Vue 3、TypeScript、API First、DOM Fallback。产品自动化不使用 Playwright。没有新建 Vue 工程，没有重写 `EasyRuntime`，没有第二套 `MessageBridge`。

## 模块

```text
src/automation/
  types.ts              任务、子任务、阶段、日志、租约
  state.ts              阶段目录和副作用等级
  task-builder.ts       复用 planDrafts 与 planMailGroups
  task-validator.ts     用当前文件和规则重算指纹
  dry-run.ts            本地规划，不调用传输
  coordinator.ts        执行租约
  checkpoint.ts         写请求前落盘
  recovery.ts           UNKNOWN 的恢复动作
  executor.ts           写阶段在门禁关闭时阻塞
  repository.ts         按站点和用户隔离任务
  logger.ts             脱敏诊断
  contract-evidence.ts  接口证据
  index.ts
```

浮窗增加 `AutomationPanel`。它挂在现有 `MailWorkspace` 里，沿用粉色面板样式。按钮只有生成计划、查看阻塞项、重新核对、复制脱敏诊断和已有邮件的只读核验。没有写操作按钮，也没有“重试全部”。

## 三个层次

| 层次 | 状态 | 职责 |
|---|---|---|
| 邮件 | `MailExecutionState` | 创建、读取、保存、关联 |
| 流程 | `WorkflowExecutionState` | 读取、规划、提交、核验 |
| 任务 | `AutomationTaskState` | 一批分组的计划和恢复 |

任务总状态由子任务聚合。一个分组成功、一个阻塞、一个未知，各自保留自己的状态。不会用邮件状态代表整批业务。

## 阶段副作用

阶段目录在 `STAGES`。执行器按单阶段声明决定能不能写，不靠一个顺序数组循环假装跑完业务。

| 等级 | 阶段 |
|---|---|
| 无副作用 | 选择、客户解析、描述映射、分组、收件人、标题、正文、草稿校验、差异、节点、审核人、计划、审核预览 |
| 只读 | 会话、文件查询、邮件读取、邮件核验、流程读取、版本比较、流程核验、最终核验 |
| 写入 | `MAIL_CREATE`、`MAIL_SAVE`、`FILE_BIND`、`WORKFLOW_SUBMIT`、`REVIEW_EXECUTE` |

写入阶段当前一律 `BLOCKED`。原因是邮件写开关关闭、流程写开关关闭，以及跨标签页写互斥尚未证明。`prepareStage` 不调用传输，也不把未发出的请求标成 `requestSent`。

## Dry-run

`runDryRun` 调用现有 `planDrafts` 和 `planMailGroups`。传入的 `EasyTransport` 不会被使用。测试用记录调用的 fetcher 证明 `MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd` 都没有出现。

阻塞来自现有规则：客户未确认、描述为空、发文类型没有映射、收件人为空。这些结果是 `BLOCKED`，不会被标成 `DRY_RUN_COMPLETED`。

## 已有邮件诊断

`DIAGNOSE_EXISTING_MAIL` 走现有内容脚本和 `EasyRuntime`。它读取邮件、关联文件和流程，`writesAttempted` 固定为 false。提交仍要求 PatMail 已核验的邮件记录，因此输入一个已有 `mail_id` 不能保存或提交流程。
