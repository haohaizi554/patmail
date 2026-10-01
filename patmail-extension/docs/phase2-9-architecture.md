> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.9 架构

日期：2026-09-26。

本阶段修复任务身份和执行可靠性，并加上现场只读验收、证据库和受控测试写。运行路线仍是 Chrome Extension、Vue 3、TypeScript、API First、DOM Fallback。没有新建工程，没有重写 `EasyRuntime`，产品运行引擎不是 Playwright。

## 信任边界

```text
Vue 面板
  → typed message
Background Service Worker
  → IndexedDB（扩展源）
      patmail-automation-tasks
      patmail-execution-ledger
      patmail-evidence
内容脚本
  → 只读验收探测，沿用页面已有会话
```

内容脚本不修改租约。页面 IndexedDB 不再作为任务和证据的权威存储。

## 模式

`ExecutionMode` 只有 `DRY_RUN`、`LIVE_READONLY`、`TEST_WRITE`。`executionMode('PRODUCTION_WRITE')` 返回 null，生产模式不能进入。

## 界面

`AutomationPanel` 继续负责计划和历史。新增 `LiveAcceptancePanel` 与 `ControlledExecutionPanel`。默认测试白名单是空的，确认按钮在门禁未通过时不会发写请求。
