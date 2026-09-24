# PatMail 第一阶段实施计划

## 目标与范围

以用户提供的第一阶段规格为准，完成现有 Vue 3 + TypeScript + Vite / Manifest V3 插件骨架。
在当前目录继续已有未提交代码，保持仓库中的业务前端和设计资料原样。
不接入 API，不自动提交、不下载、不发邮件、不实现规则引擎。

## 设计

- Manifest 在获授权的 EASY 与本地开发网页顶层文档 `document_idle` 注入单文件 IIFE Content Script。
- 页面只新增一个 `patmail-root` 宿主；Vue、CSS、DOM 预览全部放入 ShadowRoot。
- 浮窗与 Content Script 同处扩展隔离环境，通过 Promise MessageBridge 请求响应；
  Popup 与 Content Script 用 `chrome.tabs.sendMessage`；Content Script 与 Service Worker
  用 `chrome.runtime.sendMessage`。不借助网页可伪造的全局事件总线。
- 消息采用 `{ type, payload }` 可辨识联合类型，运行时校验未知消息；有效负载不得滥用 any。
- 第一阶段只扫描当前顶层 DOM，不穿透 iframe 或网页自身 Shadow DOM。
- L2 快照将 input、textarea、select、button 统一放入 `controls`；按钮类型的 input 计入按钮统计（包括 image）。密码、文件及敏感名称控件值被遮蔽；扫描历史不保存。
- Background 提供 PING/PONG 运行状态探测，预留后续扩展入口，不持久化表单数据。
- 360×600 粉白淡紫浮窗，支持拖动、视口边界约束、收缩、关闭。小视口自适应。
- 审查补充：最低 Chrome 114；使用 manual Popover 顶层宿主避免 body transform 导致浮窗随页面滚动，DOM 层级仍保持 body → patmail-root → ShadowRoot。
- Popup 支持扫描当前标签页、关闭后重新打开浮窗，并对受限页面显示明确提示。
- `api/`、`rules/`、`automation/` 和 `services/api.ts` 只保留说明或类型占位。

## 实施步骤

- [x] 1. 构建与验证工具：启用 vue-tsc、测试脚本、锁文件；验证双入口构建与 manifest 路径。
- [x] 2. 消息与扫描：测试畸形消息、input/textarea/select/button、动态 DOM、Shadow DOM 隔离、密码值和 image 按钮；实现必要修复。
- [x] 3. 浮窗与 Popup：实现有界 JSON 调试预览与完整复制、加载与错误反馈、拖动和收缩边界、关闭清理和重新打开。
- [x] 4. 集成测试：安装依赖、类型检查、单元测试、生产构建；真实 Chromium 加载 dist 测试自动注入、通信、扫描、拖动、关闭和刷新。
- [x] 5. 审查与说明：修复审查问题，交付 README、验收页和第二阶段建议。

## 审查重点

1. 网页样式不能覆盖浮窗，也不能使浮窗 CSS 泄漏到网页。
2. content.js 不得含外部 ES module 导入，Vue 必须使用预编译模板满足 MV3 CSP。
3. Service Worker 不访问 DOM；Popup 正确处理没有接收端和扩展上下文失效。
4. 拖动取消、窗口缩小、收缩再展开后浮窗仍在屏幕内。
5. 扫描不修改表单、不触发提交，不把插件自身按钮计入结果。

## 执行记录

- 初始检查：已有插件骨架，background 的 PageSnapshot 导入错误；普通 tsc 不检查 Vue 模板；消息只检查 type；缺少端到端验收和说明。
- 分工：主执行者负责构建、类型/通信与集成；独立子任务负责浮窗交互和审查。
- 2026-09-23：16 项扫描与消息单元测试通过，vue-tsc 与 Vite 双阶段生产构建通过；依赖审计零已知漏洞。
- 审查回归：body transform + 滚动 500px，旧浮窗 y=-396，证实固定定位失效；增加真实浏览器回归用例后修复顶层宿主。
- 2026-09-24 收口：升级 PageSnapshot V2 与 L2 语义扫描；缩小权限；增加单文档唯一宿主和 document.write 恢复回归。最终验收结果见 phase1-closure-report.md。
