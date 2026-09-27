# Phase 3.8 报告

本次在 `patmail-extension` 内执行。下面的次数来自这一轮命令。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过。27 个文件，198 个测试 |
| `pnpm build` | 通过 |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |
| `pnpm pack:source` | 通过。379 个条目，没有私钥文件名 |
| `pnpm pack:delivery` | 通过。12 个条目，没有私钥文件名 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。

`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED` 和 `productionWriteAllowed()` 都是 `false`。客户 GUID 和文件描述可选性都未确认，`MAIL_CREATE`、`MAIL_SAVE` 和描述写阶段继续不可执行。

## 修复前后

修改前，同一页从文件 A 更新为文件 B 时磁盘写入和删除都失败。清掉内存后，磁盘上的 A 重新得到 `SEARCH_RESPONSE_OBSERVED`。

修改后，A 保持历史观察，验证级别是 `FILE_SOURCE_UNVERIFIED`，恢复状态是 `RECOVERED_PENDING_REVALIDATION`。删除失败会留下“不能视为已撤销”。没有 IndexedDB 时结果是 `MEMORY_ONLY`，重启后不能恢复可信来源。任务在 T0+35 分钟被标成证据过期，原来的 `fetchedAt` 不变。

浏览器里用真实 IndexedDB 保存查询，关闭 Service Worker 后，旧来源不再是当前可信来源。把任务证据失效时间改到过去并重新打开后，页面显示“查询证据已过期，请重新查询。” `fetchedAt` 保持原值。新增查询只走 `GetSearchFiles`。被阻止的邮件验收没有增加 `Mail.ashx` 调用。

## 实际修改

- `src/automation/file-search-snapshot.ts`
- `src/automation/evidence-evaluation.ts`（新增）
- `src/automation/stage-plan.ts`
- `src/automation/task-validator.ts`
- `src/automation/task-builder.ts`
- `src/automation/dry-run.ts`
- `src/automation/types.ts`
- `src/background/workspace.ts`
- `src/api/file-search-types.ts`
- `src/floating/AutomationPanel.vue`
- `scripts/delivery-guard.mjs`（新增）
- `scripts/pack-source.mjs`
- `scripts/pack-delivery.mjs`（新增）
- `package.json`
- `tests/phase3-5.test.ts`
- `tests/phase3-6.test.ts`
- `tests/phase3-7.test.ts`
- `tests/phase3-8.test.ts`（新增）
- `tests/packaging-security.test.ts`（新增）
- `tests/extension.e2e.mjs`

## 未完成项

- 真实 EASY 用户、文件、字典、邮件和流程读取仍是 PENDING。
- EASY 客户 GUID 没有已确认来源。文件描述节点可选性仍是 pending。
- `dist.pem` 仍在工作区和 Git 历史中。两份正式压缩包已经排除它。索引移除和密钥轮换留给所有者。
