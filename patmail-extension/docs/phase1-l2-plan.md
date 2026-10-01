> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 1 收口与 L2 Form Semantic Scanner 实施计划

## 当前基线

2026-09-24：现有 Manifest V3 + Vue3/TypeScript/Vite 双入口构建、顶层 Popover Shadow DOM 浮窗、拖动/收缩/关闭、统一消息协议、L1 扫描和 Popup。当前真实 Chromium 验收 9 组通过。完整审计以任务中的 Existing Architecture Audit 为准。

## 目标数据流

`SCAN_PAGE` 仍由 Content Script 响应，但 `SCAN_RESULT.payload` 升级为 `PageSnapshot` V2：`version: 2`、`page`、`controls`、`stats`、`iframes`、`scannedAt`。不引入第二种扫描消息，也不修改 Service Worker 的职责。

## 模块边界

- `shared/types.ts`：V2 页面、控件、选项、iframe、统计类型；`summarize` 为 Popup/浮窗保留简洁摘要接口。
- `shared/guards.ts`：消息边界运行时校验 V2 负载。
- `content/scanner.ts`：每次单次扫描的编排，选择原生控件和 iframe，返回纯 JSON。
- `content/{control-scanner,label-resolver,visibility,attribute-reader,semantic-resolver}.ts`：控件采集、有限距离标签、可见性、敏感属性过滤、通用候选优先级。
- `content/injector.ts`：文档级唯一宿主，重复执行/扩展重新加载时替换旧实例；局部 body 更新后恢复；关闭时不自动恢复。
- `floating/App.vue`：展示 V2 数量和前 20 个字段的可折叠 Debug 区；复制按钮按需序列化完整 JSON。
- `manifest.json`：生产 EASY 主机及开发 loopback，移除无使用权限。

## 顺序

- [x] 先写 L2 模型行为测试，确认当前扫描返回值与 V2 期望不符。
- [x] 实现纯数据扫描模块：字段语义、可见性、安全属性、选项、iframe 元信息、扫描耗时。
- [x] 更新消息校验、Popup 摘要与浮窗 Debug/复制，避免默认渲染完整 JSON。
- [x] 为唯一注入和局部重载写真实扩展回归测试；在原注入器内修复生命周期，包括 document.write 整页重写。
- [x] 缩小 Manifest 权限，更新现有 E2E 及文档，执行 pnpm install/test/typecheck/build 和 Chromium 验收。

## 明确界限

“可见”指有可渲染尺寸且自身与祖先未被 CSS/hidden 隐藏；页面滚动区以外但有布局的控件仍视为可见。只扫描顶层文档已有的原生 input/select/textarea/button；不点击下拉、不递归 iframe 或业务网页 Shadow DOM。敏感控件值与敏感属性值使用 `[REDACTED]`；URL 查询中敏感参数及 hash 不输出。不缓存扫描结果、不自动修改表单。
