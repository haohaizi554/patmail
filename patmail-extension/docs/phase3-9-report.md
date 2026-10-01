> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.9 报告

本次在 `patmail-extension` 内执行。下面的次数来自这一轮命令。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过。28 个文件，207 个测试 |
| `pnpm build` | 通过 |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |
| `pnpm pack:source` | 通过。388 个条目 |
| `pnpm pack:delivery` | 通过。12 个条目 |
| `pnpm verify:archive` | 通过。388 与 12 个成员，没有私钥文件名，也没有白名单以外的路径 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。

`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED` 和 `productionWriteAllowed()` 都是 `false`。客户 GUID 和文件描述可选性都未确认。

## 修复前后

修改前，查询运行里文件 A 已被替换成 B 之后，已保存任务的 `evaluateTaskEvidence()` 仍可以是 `freshness=FRESH`、`requiresRevalidation=false`。一份 `PERSISTED` 加一份缺失 `persistence` 会得到整体 `PERSISTED`。一份有效期加上一份缺失时间会得到 `FRESH`。

修改后，当前核验返回 `FILE_REMOVED`，`currentTrust` 为 false，历史 `fetchedAt` 不变。缺失持久化或缺失时间得到 `UNKNOWN`，并要求重新核验。新增一页不会撤销未变化的文件。字段变化返回 `FILE_FIELDS_CHANGED`。Service Worker 重启后的磁盘记录是 `RECOVERED_PENDING_REVALIDATION`。已发送请求的任务保持 `UNKNOWN` 和原检查点。

浏览器里用真实查询把已保存任务的文件 A 重查成 B，再打开任务详情，页面显示当前结果不再包含该文件。这次重查没有增加 `Mail.ashx` 调用。

## 实际修改

- `src/automation/evidence-evaluation.ts`
- `src/automation/file-search-snapshot.ts`
- `src/automation/task-builder.ts`
- `src/automation/task-validator.ts`
- `src/automation/stage-plan.ts`
- `src/background/authority.ts`
- `src/background/index.ts`
- `src/background/account-data.ts`
- `src/floating/AutomationPanel.vue`
- `src/app/pages/TasksPage.vue`
- `src/shared/message.ts`
- `scripts/verify-archive.mjs`（新增）
- `package.json`
- `tests/phase3-9.test.ts`（新增）
- `tests/packaging-security.test.ts`
- `tests/extension.e2e.mjs`

## 未完成项

- 真实 EASY 用户、文件、字典、邮件和流程读取仍是 PENDING。
- EASY 客户 GUID 没有已确认来源。文件描述节点可选性仍是 pending。
- 签名密钥已移出工程目录，Git 历史里仍然有。索引移除和密钥轮换留给所有者。
