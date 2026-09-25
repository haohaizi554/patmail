# Phase 2.7 收口

日期：2026-09-26。本文件记录进入 Phase 2.8 之前对现有源码的审计，以及 Phase 2.8 如何收口这些缺口。审计以 `src/automation/`、`src/mail/`、`src/workflow/`、`src/floating/AutomationPanel.vue`、`src/background/index.ts` 和 Phase 2.7 测试为准。

## 审计时已经成立的部分

- 任务、子任务、阶段目录、Dry-run、检查点纯函数、恢复动作和执行协调器都已存在。
- Dry-run 不调用传输。写阶段由 `prepareStage` 在写开关关闭时阻塞。
- `EASY_MAIL_WRITES_ENABLED` 与 `WORKFLOW_WRITES_ENABLED` 为 false。`crossTabCreateAtomic` 为 false。`CROSS_TAB_WRITE_EXCLUSION_PROVEN` 为 false。
- `GetFlowSubmit` 的 502 和空响应不算成功。`EndEmailFlowd` 没有被当成审核或发送。审核人只按 GUID 匹配。
- 邮件、流程、任务仍是三层状态，没有互相冒充。

## 审计时未收口的问题

1. 任务编号把业务指纹前 24 个字符当成 `taskId`。指纹以站点和操作员开头，不同任务会撞号并互相覆盖。
2. 同一份业务输入再次生成计划时，没有独立的任务实例身份。
3. 指纹主要绑在 revision 和选择串上。规则正文、收件人、签名、客户绑定发生内容变化时，不一定改变任务身份。
4. `TaskRepository` 使用 `chrome.storage.local` 读改写，并用固定长度裁剪历史。`AutomationPanel` 的计划主要留在组件内存，重新打开插件后列表为空。
5. 任务层的客户身份取第一组。多客户批次会被标成单一客户。
6. 检查点挂在整批任务上，没有绑定到 `TaskItem`。
7. `chrome.storage` 上的两把进程内锁，在写入延迟时可以同时领取同一指纹。Service Worker 重启不能只靠内存 Map。
8. Dry-run 的“零写请求”如果只检查日志数组，不能证明传输没有被调用。
9. `ContractEvidence` 是静态目录。把 `responseCaptured` 改成 true 不能、也不应该打开写门禁，但当时没有单独的证据等级来挡住这种做法。
10. 当前环境没有已登录的 EASY 会话。真实只读联调和写接口回读都还没有现场记录。

## Phase 2.8 的收口方式

| 审计项 | 收口 |
|---|---|
| 任务编号碰撞 | `taskId` 改为 `crypto.randomUUID()`。业务指纹改为规范化内容的 SHA-256 |
| 旧编号 | 保留旧编号、写入迁移记录，不删除原任务。无法可靠迁移时只读 |
| 面板内存态 | `AutomationTaskService` 负责创建、列出、保存、校验、归档、恢复 |
| 多客户 | `customers` 列出全部客户。只有一位客户时才写入单一客户编号 |
| 检查点 | `CheckpointService` 按子任务落盘。落盘失败则不发请求 |
| 执行记录 | Background 领取改为 IndexedDB 的 readwrite 事务。未释放且已发请求的租约不裁剪 |
| Dry-run | 输出 `AutomationStagePlan`。测试统计 Mock Transport 的调用次数 |
| 契约 | 证据等级与脱敏分析。`productionWriteAllowed()` 固定返回 false |
| 现场 EASY | `LIVE_EASY_ACCEPTANCE.status` 为 `PENDING` |

生产写开关在收口后仍然关闭。跨标签页写互斥对 `chrome.storage` 路径仍未证明，因此 `crossTabCreateAtomic` 保持 false。
