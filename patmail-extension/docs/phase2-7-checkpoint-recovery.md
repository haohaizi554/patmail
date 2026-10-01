> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.7 检查点与恢复

日期：2026-09-26。

## 请求前落盘

写阶段在请求发出前追加检查点，`requestSent` 为 true。本阶段的生产执行器不会走到这一步：门禁未满足时 `prepareStage` 返回 `blocked`，检查点数量保持 0。

测试直接调用 `markRequestSent`，确认创建、保存、关联和流程提交都可以先留下“请求即将发出”。

## UNKNOWN

没有确定响应时调用 `markUnknown`。恢复动作：

| 已发出的阶段 | 动作 |
|---|---|
| `MAIL_CREATE` | 停止。禁止自动再次创建。 |
| `MAIL_SAVE` | 重新读取 `GetMailInfo`。 |
| `FILE_BIND` | 重新读取 `GetMailFile`。 |
| `WORKFLOW_SUBMIT` | 重新读取 `GetFlowInfo` 和 `GetFlowHistory`。 |
| `REVIEW_EXECUTE` | 保持 pending。审核写接口还没有核对。 |
| 其他写阶段 | 停止。 |
| 还没有写请求 | 可以重新做只读规划。 |

只读阶段允许重试。创建未知不允许自动重试。`prepareStage` 看到任务已经是 `UNKNOWN` 时返回 `unknown-stop`。

## 部分成功

恢复函数不删除已有子任务。一个子任务可以是 `COMPLETED`，另一个是 `UNKNOWN`。恢复只说明下一步该重读还是停止，不会为了继续运行而重新创建已经成功或结果未知的邮件。

## 流程恢复

页面重新打开后，`restore` 用持久化的 `WorkflowExecutionRecord` 重读流程。内存里的计划不恢复。

如果记录停在 `SUBMITTING` 且 `requestSent` 为 true，先进入 `UNKNOWN`，再重读。随后的 `submit` 看到 `UNKNOWN` 直接返回，测试里 Mock 提交次数为 0。
