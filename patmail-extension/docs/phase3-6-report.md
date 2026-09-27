# Phase 3.6 报告

本次在 `patmail-extension` 内执行。下面的次数来自这一轮命令。

## 命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm test` | 通过。24 个文件，175 个测试 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过。`vue-tsc --noEmit` 后完成页面包和 content script |
| `pnpm test:e2e` | 通过。15 项浏览器检查，浏览器错误 0 |

真实 EASY 只读验收：**PENDING**。没有已授权会话。Fixture 不算现场通过。

生产邮件写操作和生产流程写操作保持关闭。`productionWriteAllowed()` 仍为 `false`。

## 先复现的缺陷

- 同一页先返回文件 A，再返回文件 B。页面 `fileIds` 已是 `["B"]`，会话文件索引仍是 `["A", "B"]`。A 继续得到 `SEARCH_RESPONSE_OBSERVED`。
- 查询响应只有文件 ID、描述文本和客户名称。页面另交 `fileDescriptionId`、`customerId`、`caseId` 时，这些 GUID 被原样保留。

两条测试在修改前失败，修改后通过。

## 实际修改

- `src/automation/file-search-snapshot.ts`
- `src/automation/file-description-resolver.ts`（新增）
- `src/automation/task-builder.ts`
- `src/automation/types.ts`
- `src/background/workspace.ts`
- `src/shared/message.ts`
- `src/api/file-search-types.ts`
- `src/mail/types.ts`
- `src/mail/selection.ts`
- `src/floating/FileSearchPanel.vue`
- `tests/phase3-6.test.ts`（新增）
- `tests/phase3-5.test.ts`
- `tests/phase3-4.test.ts`
- `tests/extension.e2e.mjs`

## 行为

- 查询运行 ID 和查询条件指纹分开。翻页沿用 Background 签发的同一次运行。重新查询或改变每页条数会开始新运行。
- 某一页更新后，不再被有效页面引用的文件失去来源。另一页仍引用的文件保留该页证据。
- 不同查询运行不会自动混成一个可信任务。
- 可信字段由查询快照重建。未验证的内部 GUID 不进入计划。响应没有的 `caseId` 不使用页面值。
- 文件描述 ID 只在案件类型明确且字典唯一匹配时记为已验证。客户 GUID 当前没有查询响应来源，保持未验证。本地客户绑定与 EASY 客户名称分开。
- 任务用 `identityGate` 分别表示文件来源、描述 ID 和客户 GUID，不用一个标签代表全部已验证。
- IndexedDB 写入返回 `PERSISTED`、`MEMORY_ONLY` 或 `FAILED`。只有成功写入的会话能在重启后恢复。
- 查询发出前冻结账号。账号切换后的迟到响应不写入新账号。
- 完整页面路径经过消息桥：查询第 1 页和第 2 页、选择、按快照重建、绑定客户、保存、刷新恢复。消息桥另用同一次运行的第 3、4 页，并确认伪造的描述 ID、客户 ID 和案件 ID 没有进入任务。

## 未确认的内部 GUID

- 文件描述内部 ID 不在当前 `GetSearchFiles` 归一化字段里。唯一的 `LoadFileTypeByCaseType` 匹配才算 `EASY_DICTIONARY`。
- 客户内部 GUID 没有可靠的查询字段。文件不携带页面或本地 Profile 上的客户 GUID。

## 剩余缺口

- `GetSearchFiles`、`GetMailRule`、`GetCustomerContact`、`GetSignature`、`GetFlowSubmit` 的验收契约继续 `CONTRACT_PENDING`。
- 真实 EASY 只读联调为 PENDING。
- 没有按文件 ID 的回读接口，因此没有 `FILE_READBACK_VERIFIED`。
- 没有进入 Production Write。
