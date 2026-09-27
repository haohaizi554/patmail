# Phase 3.7 报告

本次在 `patmail-extension` 内执行。下面的次数来自这一轮命令。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm test` | 通过。25 个文件，187 个测试 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过。`vue-tsc --noEmit` 后完成页面包和 content script |
| `pnpm pack:source` | 通过。源码白名单包 367 个条目，列表中没有 `.pem` |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。Fixture 不算现场通过。

生产邮件写操作和生产流程写操作保持关闭。`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED` 和 `productionWriteAllowed()` 都是 `false`。

## 缺陷复现

修改前，同一页同时给出 `fileId=A`、描述“专利证书”和 `fileId=A`、描述“审查意见通知书”时，测试期望会话状态 `CONFLICT`，实际得到 `ACTIVE`。该测试失败后才改业务实现。修改后，同页冲突、跨页冲突、冲突消除后重算、旧页证据过期、内存记录、保存失败、无效 continuation 和身份门禁测试都包括在上述 187 个测试里。

## 实际修改

- `.gitignore`
- `patmail-extension/.gitignore`
- `patmail-extension/package.json`
- `patmail-extension/scripts/pack-source.mjs`（新增）
- `src/api/dictionaries/types.ts`
- `src/api/file-search-types.ts`
- `src/schema/file-type-tree.ts`
- `src/automation/file-search-snapshot.ts`
- `src/automation/file-description-resolver.ts`
- `src/automation/stage-plan.ts`
- `src/automation/task-builder.ts`
- `src/automation/types.ts`
- `src/background/workspace.ts`
- `src/floating/FileSearchPanel.vue`
- `tests/phase3-6.test.ts`
- `tests/phase3-7.test.ts`（新增）
- `tests/extension.e2e.mjs`

## 浏览器覆盖

现有完整页面流程仍覆盖连接 Fixture、第一页、第二页、跨页选择、后台重建、客户绑定、任务、证据、保存、刷新和恢复。同一检查里新增：

- 同页重复 ID 返回两条记录，来源状态是“查询运行冲突。”，任务为 `BLOCKED`，文件来源未验证。
- 错误 continuation 返回 `QUERY_SESSION_INVALID`，不保留来源 ID。
- 正常查询来源状态是“已保存查询来源。”，任务 `evidenceRestorable` 为 true。
- 文件描述 ID 和客户 GUID 都未验证。

旧页 30 分钟过期、仅内存保存和 IndexedDB 写入失败由单元测试用模拟时钟和磁盘替身覆盖。浏览器里的 IndexedDB 会真实写入，不能把环境失败说成业务通过。账号切换、查询条件变化、规则变化和 Background 重启仍在原有完整流程里。新增请求只走 `GetSearchFiles`。被阻止的邮件验收没有增加 `Mail.ashx` 调用。

## 剩余缺口

- 真实 EASY 会话、文件、字典、邮件和流程读取仍是 PENDING。
- `GetSearchFiles` 验收构建、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 仍是 `CONTRACT_PENDING`。
- `TreeType` 不能判断节点是否可选，文件描述发文参数保持待确认。
- 搜索响应没有确认 EASY 客户 GUID，`MailCustomer` / `SaveMailInfo` 写阶段保持阻塞。
- `dist.pem` 仍在 Git 历史和工作区。忽略规则和源码白名单已经生效，索引移除和密钥轮换留给所有者，避免改变现有扩展 ID。
