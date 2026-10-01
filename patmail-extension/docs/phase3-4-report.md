> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.4 报告

本次在 `patmail-extension` 内执行。下面的次数来自这一轮命令。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm test` | 通过。22 个文件，160 个测试 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过。`vue-tsc --noEmit` 后完成页面包和 content script |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。Fixture 不算现场通过。

生产邮件写操作和生产流程写操作保持关闭。`productionWriteAllowed()` 仍为 `false`。

## 本轮先失败、后修好的检查

- `query-dependency.ts` 在补上函数签名前有语法错误，8 个测试套件无法转换。补上 `buildQueryDependencies` 的函数头后，单元测试通过。
- `vue-tsc` 第一次失败：`TaskRepository` 缺少 `updateTaskAtomically`；`createTaskPlan` 测试缺少协议要求的 `queryTemplateVersion`；`readonlyContract` 测试多传了不存在的 `origin`。补上存储方法和测试参数后通过。
- 完整页面第一次失败：伪造完成状态的任务仍带着已有 `easyMailId`，拒绝文案是「不能由页面写入邮件或流程标识。」测试改为同时清掉邮件和流程标识后，拒绝文案是「不能由页面声明子任务完成。」随后 `pnpm test:e2e` 通过。

## 实际修改

- `src/automation/task-transition.ts`（新增）
- `src/automation/file-search-snapshot.ts`（新增）
- `src/automation/query-dependency.ts`
- `src/automation/repository.ts`
- `src/automation/indexed-store.ts`
- `src/automation/task-service.ts`
- `src/automation/task-builder.ts`
- `src/automation/task-validator.ts`
- `src/automation/types.ts`
- `src/automation/acceptance-runner.ts`
- `src/background/authority.ts`
- `src/background/workspace.ts`
- `src/background/account-data.ts`
- `src/shared/message.ts`
- `src/app/composables/useWorkspace.ts`
- `src/app/pages/AcceptancePage.vue`
- `tests/phase3-4.test.ts`（新增）
- `tests/phase3-1.test.ts`
- `tests/phase3-3.test.ts`
- `tests/extension.e2e.mjs`

## 行为

- 正式页面不能再用 `SAVE_TASK` 插入完整任务。新任务由 `createTaskPlan` 保存，来源是当前绑定的 EASY origin。
- 页面不能用子任务 `COMPLETED` 或 `verified=true` 且 `requestSent=false` 的检查点得到执行结论。
- 版本检查和写入在同一次存储临界区完成。旧版本的 `READY` 不能覆盖已经写入的 `UNKNOWN`。
- 模板摘要不再使用 `key=value` 换行拼接。依赖快照只包含任务实际引用的客户。无关客户的模板变化不会使任务过期。
- 缺少依赖快照的旧任务为 `LEGACY_DEPENDENCY_UNKNOWN`，只读，不能进入真实写操作。
- 已有客户必须提供 `expectedRevision`，已有模板必须提供 `expectedVersion`。队列只覆盖同一个 Background 实例。
- 同一账号代际内，两个修改请求各自收到自己的结果。账号切换才丢弃旧回执。
- 文件 ID 在当前查询快照中时来源为 `SEARCH_RESPONSE_OBSERVED`。不在快照中时保持 `FILE_SOURCE_UNVERIFIED`。没有 `FILE_READBACK_VERIFIED`。
- 完整页面路径覆盖绑定、查询、保存计划、刷新恢复、模板变化后过期、伪造子任务完成被拒绝，以及已有 `UNKNOWN` 证据不被 `SAVE_TASK` 改写。

## 剩余缺口

- `GetSearchFiles`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 继续 `CONTRACT_PENDING`。
- 真实 EASY 只读联调为 PENDING。
- `chrome.storage.local` 没有被当成跨进程事务数据库。
