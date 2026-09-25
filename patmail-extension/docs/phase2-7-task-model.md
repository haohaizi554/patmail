# Phase 2.7 任务模型

日期：2026-09-26。

## AutomationTask

一个任务绑定一个站点、一个操作者、一份文件集合、一套客户配置和当时的规则版本。

字段包括 `taskId`、`origin`、`operatorId`、`customerProfileId`、`customerName`、`selectionFingerprint`、`taskFingerprint`、`selectedFiles`、`mailRuleRevision`、`queryTemplateVersion`、`mailGroups`、`mailDrafts`、`status`、`createdAt`、`updatedAt`、`checkpoints`、`issues`、`items`。

`taskFingerprint` 由选择指纹和查询模板版本组成。选择指纹本身包含站点、用户、规则修订和文件身份。`buildTask` 不读取调用方传入的指纹字符串。

## AutomationTaskItem

每个邮件分组是一个子任务。字段包括 `itemId`、`taskId`、`customerProfileId`、`fileIds`、`fileNames`、`fileDescriptionIdentity`、`mailTypeId`、`sendMode`、`mailDraftPreview`、`easyMailId`、`mailExecutionId`、`workflowExecutionId`、`status`、`issues`。

草稿没有错误时子任务是 `DRY_RUN_COMPLETED`。有错误、被跳过或整批为空时是 `BLOCKED`。同一批次可以同时存在完成、阻塞和未知。

## 任务状态

`CREATED`、`VALIDATING`、`READY`、`DRY_RUNNING`、`DRY_RUN_COMPLETED`、`CONFIRM_REQUIRED`、`QUEUED`、`RUNNING`、`PAUSED`、`WAITING_USER`、`BLOCKED`、`PARTIAL_FAILURE`、`UNKNOWN`、`COMPLETED`、`CANCELLED`、`FAILED`、`STALE`。

本阶段实际落到 `DRY_RUN_COMPLETED`、`BLOCKED`、`STALE`、`RUNNING`、`UNKNOWN`。写阶段被门禁挡住，所以不会进入真实的 `COMPLETED`。

## 快照校验

重新执行前 `validateTask` 做两件事：

1. 用任务里冻结的文件、规则修订和模板版本重算指纹。
2. 用当前用户、站点、文件、规则修订和模板版本再算一次。

两者不一致、调用方改过指纹、账号或站点不同、操作者不是 GUID，任务进入 `STALE`。不能靠传入一个新的指纹字符串声称配置没变。

文件名变化、规则修订变化、查询模板版本变化、跨账号复用，测试里都会变成 `STALE`。
