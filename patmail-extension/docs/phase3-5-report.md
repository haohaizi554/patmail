> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.5 报告

本次在 `patmail-extension` 内执行。下面的次数来自这一轮命令。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm test` | 通过。23 个文件，166 个测试 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过。`vue-tsc --noEmit` 后完成页面包和 content script |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。Fixture 不算现场通过。

生产邮件写操作和生产流程写操作保持关闭。`productionWriteAllowed()` 仍为 `false`。

## 本轮先失败、后修好的检查

- 完整页面跨页计划的 `fileSource` 实际是 `FILE_SOURCE_UNVERIFIED`。两次查询都成功，会话也有 2 个。原因是 Fixture 按页码生成 `file-1`、`file-2`，页面里前一次「我方文号 A+123」和后一次「E2E-PAGE」得到了相同文件 ID、不同文号。解析把同一 ID 出现在多个会话里一律当成不可用。
- 修复后，只有业务字段一致的覆盖会话才采用最近一次；字段不一致时不挑选胜者。完整页面断言改为核对真实的第 1 页和第 2 页计划。消息桥改用第 3 页和第 4 页，避免和前一次查询撞同一批 Fixture ID。
- 诊断用的 `QUERY_SESSION_DEBUG` 已从 `createTaskPlan` 删除。
- `TaskSaveResult` 改为判别联合后，`phase3-4` 在失败分支读取 `message` 前先判断 `ok`。`vue-tsc` 随后通过。

## 实际修改

- `src/automation/file-search-snapshot.ts`
- `src/automation/repository.ts`
- `src/automation/indexed-store.ts`
- `src/automation/task-builder.ts`
- `src/automation/task-service.ts`
- `src/automation/task-validator.ts`
- `src/automation/checkpoint-service.ts`
- `src/automation/types.ts`
- `src/background/account-data.ts`
- `src/background/workspace.ts`
- `src/shared/message.ts`
- `tests/phase3-5.test.ts`（新增）
- `tests/phase3-4.test.ts`
- `tests/extension.e2e.mjs`

## 行为

- 同一查询条件的每一页留在同一个 `FileQuerySession`。查询指纹来自规范化查询条件。
- 不同查询条件、账号、标签页或连接版本不能拼成同一个可信列表。
- Background 按快照重建文件名称、描述、客户和案件字段。本地客户绑定单独保存。
- 任务级来源取逐文件结果的最低等级，并且要求同一个查询会话。没有伪造 `FILE_READBACK_VERIFIED`。
- 查询会话写入 IndexedDB，30 分钟过期。内存丢失后可以恢复；清空或过期后降为未核验。
- `save` 对受保护任务返回 `PROTECTED_EVIDENCE`。`UNKNOWN` 不会被改成 `STALE`，改为 `needsRevalidation`。
- `updatedCount` 只统计实际写入。规则保存和任务重新核验分开返回。
- 完整页面路径经过 `chrome.runtime.sendMessage`、Background 和任务存储：查询第 1、2 页，跨页选择，客户绑定，按快照重建，保存任务，刷新后仍能读到同一任务。

## 剩余缺口

- `GetSearchFiles`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 的验收契约继续 `CONTRACT_PENDING`。
- 真实 EASY 只读联调为 PENDING。
- `chrome.storage.local` 没有被当成跨进程事务数据库。
- 没有进入 Production Write。
