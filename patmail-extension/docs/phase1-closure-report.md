> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# PatMail Phase 1 收口报告

日期：2026-09-24

## Existing Architecture Audit

实际项目位于 `patmail-extension/`。构建由 `vite.config.ts` 生成 Popup/Background，由 `vite.content.config.ts` 生成单文件 Content Script；`manifest.json` 是 MV3。已有 `src/background`、`src/content`、`src/floating`、`src/popup`、`src/shared`、`src/utils`，并有单测、真实 Chromium 本地夹具和后续模块占位。没有为了提示词目录搬迁源码。

原有 Vue3/TypeScript/Vite 架构、Service Worker PING、消息桥、Shadow DOM/Popover 浮窗、拖动/折叠/关闭、Popup、L1 扫描和两阶段构建可继续沿用。主要缺口是 V2 模型、标签与候选语义、状态/可见性、敏感属性过滤、iframe 元信息、调试预览/复制以及重复执行和旧页面局部重写的生命周期回归。

## Phase 1 完成内容

- 在原消息协议上将 `SCAN_RESULT.payload` 升级为 `PageSnapshot` V2；运行时边界校验同步升级，Background 职责不变。
- 原扫描入口拆分为通用控件扫描、标签解析、语义候选、可见性和安全属性模块。支持 label for、嵌套 label、aria-labelledby、相邻表格单元格与简单容器文本；语义优先级和置信度明确，不含 EASY 业务字段映射。
- 读取原生 input、select、textarea、button 的属性和状态，包括 checked/selected/disabled/readonly/required、多选及 DOM 中已有的全部 option。统计总数、分类、可见/隐藏、disabled、语义识别和扫描耗时。
- 排除插件宿主与 ShadowRoot；密码/文件/隐藏及敏感名称控件值遮蔽，敏感属性值遮蔽，URL 的敏感查询参数与 hash 不输出。扫描只读、按需执行，不常驻扫描观察器，不保存结果。
- 保留原 Shadow DOM + 手动 Popover UI，增加有界 Debug Viewer 和按需完整 JSON 复制；关闭只作用于当前页面。注入器保证文档内单宿主，并处理脚本重复执行、SPA 保留、body 局部替换及 `document.write` 整页重写。
- Manifest 权限收敛为 `tabs` 与 EASY 88 端口/本地开发主机匹配；没有 `<all_urls>`、storage、activeTab 或 scripting。
- 在扩展目录设立独立 pnpm 工作区和锁文件，使 `pnpm install` 在干净环境真正安装本项目依赖。

## Scanner V2 数据模型

`PageSnapshot = { version: 2, page, controls, stats, iframes, scannedAt }`。
`page` 包含经清理的 URL、origin、hostname、pathname、search、title、iframeDepth、readyState。
`controls` 是统一原生控件列表：key、kind/tag、输入类型、id/name、值/显示值、label/aria/title/placeholder、class、状态、可见性、属性与 dataset、语义名称/来源/置信度；select 包含所有现有 option 的 value/text/selected/disabled。
`stats` 包含总数、input/textarea/select/button、可见/隐藏、disabled、语义识别和耗时；`iframes` 仅包含安全 src 与同源判断。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | 通过；确认 `pnpm list --depth 0` 指向 patmail-extension |
| `pnpm test` | 4 文件、26 项通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；生成可加载的 `dist/manifest.json`、`content.js`、Popup 与 Background |
| `pnpm test:e2e` | 本地真实 Chromium 12 项通过、0 浏览器错误 |

本地夹具的最终一次测量：8 个控件 2.8 ms，1008 个控件 198 ms。耗时随机器、样式复杂度和页面脚本变化；`stats.durationMs` 始终返回实际单次扫描时间。E2E 使用测试专用 Playwright，不进入产品运行时。

2026-09-24 对 EASY 的只读、未登录烟测：`/Login.aspx` 成功自动注入单实例并扫描 17 个原生控件；`FileSearchMail.aspx` 请求跳转至登录页后，同样完成注入和扫描。对 `FileSearch.aspx` 的尝试遇到间歇性 HTTP 502，无法确认登录后的业务页面。未持有有效会话，也未测试 `CaseManage.aspx` 的实际完整路径；业务页面兼容验收仍需按 [phase1-acceptance.md](phase1-acceptance.md) 在授权现场完成。502 和缺失的 jQuery/Ajax 资源错误来自该未登录页面的网络加载，不是本地夹具的扩展错误。

## 已知边界

- 只扫描顶层 document 的原生表单控件。iframe 仅报告元信息，业务页面自有 ShadowRoot、自定义控件、虚拟列表和动态下拉尚不识别。
- 可见性是布局可渲染判断，不等于位于当前滚动视口或未被其他元素遮挡。
- 邻近文本只检查有限层级及长度；复杂表单可能得到低置信度 name/id，需人工确认，不作业务翻译。
- 普通表单值可能进入快照，复制 JSON 只能在获授权环境使用；敏感值过滤按控件类型、名称与属性名执行，不保证识别任意网页自定义的隐式秘密。
- EASY 登录后的三个目标业务页未完成现场验收；若实际控件在 iframe 内，当前只扫描顶层控件，这是设计边界。

## 冻结与下一阶段

Phase 1 可以冻结 MV3/双入口构建、消息桥、Shadow DOM + Popover 浮窗、拖动/折叠/关闭与 Popup 基础行为。L2 的数据接口和单次扫描入口可作为后续扩展的稳定边界；后续修改应新增针对具体场景的回归测试。

本阶段没有实现 FastAPI、数据库、EASY API Client、客户/历史查询模板、Cookie 持久化、规则引擎、自动填写/审批/提交、文件下载、邮件发送、AI/OCR 或浏览器驱动产品逻辑。

**Phase 2 Recommended Next Step：** 在现场样本和获授权接口文档基础上，先设计 L3 Custom Widget Scanner，再设计 L4 API Data Sources，最后汇总到 L5 Business Schema；保留 API First + DOM Fallback 的边界，由人工确认字段映射后再考虑业务工作流。
