# Phase 2.8 阶段计划

日期：2026-09-26。

`buildStagePlans` 为每个阶段、每个 `TaskItem` 生成一条 `AutomationStagePlan`：

| 字段 | 含义 |
|---|---|
| `stage` | 阶段编号 |
| `itemId` | 子任务。没有子任务时为空 |
| `sideEffect` | `none`、`read` 或 `write` |
| `precondition` / `expectedInput` / `expectedOutput` | 来自既有 `STAGES` 目录 |
| `canExecute` | 该子任务这一步能否执行 |
| `blockers` | 阻塞说明 |
| `requiresConfirmation` | 写阶段和目录中要求确认的阶段为 true |
| `contractStatus` | 写阶段固定 `UNKNOWN` |

写阶段始终 `canExecute: false`，阻塞原因包括“写操作默认关闭”和“接口还没有完成请求、响应和回读核验”。缺客户、缺策略落到 `CUSTOMER_RESOLVE`；缺描述、缺映射落到 `DESCRIPTION_MAPPING`；缺收件人落到 `RECIPIENT_RESOLVE`。

面板在当前子任务下展示不可执行的阶段，包含阶段名、契约状态和第一条阻塞原因。

## 零写请求

`runDryRun` 把传入的 `EasyTransport` 放在未使用参数上，不发起请求。返回值包含 `plans`。

测试使用会抛错的 fetcher，并断言调用列表为空，同时断言 `writeCalls` 为空，以及 `MAIL_CREATE` 的 `canExecute` 为 false。覆盖合并文件、缺少收件人，以及规则内容变化后的 `STALE`。

Dry-run 不调用 `MailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`FlowSubmit`、`EndEmailFlowd`。

## 恢复后重算

`validateTask` 用冻结的 `ruleSnapshot`、`selectedFiles` 和 `queryTemplateVersion` 重算指纹，再与当前输入比较。文件集合、客户绑定或规则内容变化时状态为 `STALE`。

若任务已经是 `UNKNOWN`、`readonly`，或任一检查点 `requestSent`，重新核对保持 `UNKNOWN` 和只读，不会因为配置没变而回到可执行。
