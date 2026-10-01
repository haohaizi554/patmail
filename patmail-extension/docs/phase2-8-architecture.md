> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.8 架构

日期：2026-09-26。

本阶段把已有任务执行基础设施接到持久化和契约核验上。运行路线仍是 Chrome Extension、Vue 3、TypeScript、API First、DOM Fallback。没有新建工程，没有重写 `EasyRuntime`，没有第二套 `MessageBridge`，产品运行引擎不是 Playwright。

## 模块

```text
src/automation/
  sha256.ts              同步 SHA-256，供任务指纹使用
  task-builder.ts        UUID 任务编号与内容指纹
  task-validator.ts      用冻结快照对照当前配置
  task-service.ts        统一的任务业务层
  repository.ts          读取、迁移、提交、归档
  indexed-store.ts       页面任务的 IndexedDB 存储
  checkpoint.ts          检查点纯函数，绑定 itemId
  checkpoint-service.ts  写请求前落盘
  stage-plan.ts          阶段计划
  dry-run.ts             本地规划，附带阶段计划
  ledger.ts              执行所有者的事务存储
  contract-capture.ts    脱敏与证据等级
  easy-acceptance.ts     现场只读清单，默认 PENDING
  coordinator.ts         保留的 chrome.storage 协调器，互斥仍未证明
```

`src/background/index.ts` 的领取和恢复走 `ExecutionLedger`。`AutomationPanel` 只调用 `AutomationTaskService`，不直接改存储包。

## 数据边界

任务快照和执行租约是两套存储。

| 存储 | 位置 | 用途 |
|---|---|---|
| `patmail-automation-tasks` | 内容脚本所在页面的 IndexedDB | 任务列表、迁移、归档 |
| `patmail-execution-ledger` | 扩展 Service Worker 的 IndexedDB | 执行所有者、已发请求、重启恢复 |
| `patmail.automation.task.v2` | `chrome.storage` 上的仓库实现 | 测试和没有 IndexedDB 时的任务读写 |

页面库和扩展库不在同一个源。不能把它们说成一次事务。本地互斥通过，也不表示 EASY 服务端恰好执行一次。

## 写门禁

`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED`、`crossTabCreateAtomic`、`CROSS_TAB_WRITE_EXCLUSION_PROVEN` 保持 false。`productionWriteAllowed()` 固定返回 false，不读取静态目录里的 `responseCaptured`。

面板不提供重试全部写操作、强制解除 `UNKNOWN`、绕过契约、直接发送或直接审核。
