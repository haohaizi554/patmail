# PatMail Chrome Extension

PatMail 第一阶段插件底座与 L2 表单语义扫描器。使用 Manifest V3、Vue 3、TypeScript 和 Vite。扫描只读取当前顶层文档已有的原生表单控件，不提交表单、不请求业务接口，也不保存扫描历史。

## 安装、构建和加载

需要 Node.js 20.19+ 或 22.12+、pnpm，以及 Chrome 114+：

```sh
cd patmail-extension
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

打开 `chrome://extensions`，启用开发者模式，选择「加载已解压的扩展程序」，加载本目录的 `dist/`。修改源码后重新构建，在扩展管理页刷新扩展，并刷新目标网页。人工验收清单见 [docs/phase1-acceptance.md](docs/phase1-acceptance.md)。

Manifest 目前仅对 `http://183.36.43.66:88/*`、`http://127.0.0.1/*` 和 `http://localhost/*` 自动注入；后两者供本地开发和验收。浏览器内部页、其他网站及 `file://` 不在授权范围内。Popup 需要 `tabs` 权限读取活动标签页并发送消息；没有 `storage`、`scripting`、`activeTab` 或 `<all_urls>` 权限。EASY 主机显式限定 88 端口，本地地址允许所有端口。Chrome 的 host permission 忽略路径段，因此它是主机/端口级授权；content script 再按匹配规则自动注入。参见 [Chrome 匹配模式文档](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)。

## 使用方式

在授权页面刷新后，右侧出现 360×600 的 PatMail 浮窗。拖动标题栏移动，右上角可收起、展开或关闭；关闭只卸载当前页面实例，刷新后重新出现，也可从 Popup 点「打开浮窗」。点「扫描页面」获取控件数量、可见/隐藏数量和语义识别数量；点「查看 DOM」展开最多 20 个控件的调试预览；点「复制 JSON」复制完整 PageSnapshot V2。大页面不会自动把完整 JSON 渲染在浮窗中。

本地验收页的真实 Chromium 回归可运行：

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright 只属于测试依赖，正式扩展 `dist/` 中没有浏览器驱动或自动点击逻辑。

## 当前目录

```text
patmail-extension/
├── manifest.json
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── vite.config.ts
├── vite.content.config.ts
├── vitest.config.ts
├── src/
│   ├── background/index.ts
│   ├── content/
│   │   ├── index.ts
│   │   ├── injector.ts
│   │   ├── scanner.ts
│   │   ├── control-scanner.ts
│   │   ├── label-resolver.ts
│   │   ├── semantic-resolver.ts
│   │   ├── visibility.ts
│   │   └── attribute-reader.ts
│   ├── floating/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── DebugViewer.vue
│   │   ├── copySnapshot.ts
│   │   ├── usePanelDrag.ts
│   │   └── style.css
│   ├── popup/{main.ts,App.vue,index.html}
│   ├── shared/{types.ts,message.ts,guards.ts}
│   ├── utils/runtime.ts
│   └── api/, rules/, automation/, services/  # 后续阶段占位
├── tests/
│   ├── scanner.test.ts
│   ├── semantic-scanner.test.ts
│   ├── message.test.ts
│   ├── injector.test.ts
│   ├── extension.e2e.mjs
│   └── fixtures/page.html
├── docs/
│   ├── phase1-acceptance.md
│   └── phase1-closure-report.md
└── dist/  # 构建产物，加载此目录
```

## 数据与边界

`SCAN_PAGE` 返回 `PageSnapshot` V2：`version`、`page`、`controls`、`stats`、`iframes`、`scannedAt`。每个原生 input/select/textarea/button 提供状态、标签、候选语义名称和置信度。候选优先级为显式 label、aria-label、title、placeholder、邻近文本、name、id；没有 EASY 字段映射。扫描原生 select 的现有 option，不主动展开控件。

扫描只访问当前顶层 document，不进入 iframe、业务页面的 ShadowRoot 或 closed ShadowRoot。返回 iframe 的安全 src 和同源判断，留待下一阶段设计。插件宿主与 ShadowRoot 都被排除。敏感控件值、敏感属性名对应的值被遮蔽，页面 URL 的认证类查询参数被遮蔽，hash 不输出；扫描结果只在当前页面内存中，复制动作由用户触发。可见性表示有布局尺寸且自身及祖先未被 CSS/hidden 隐藏，不表示控件一定处在当前滚动视口。

浮窗 DOM/CSS 在独立 ShadowRoot 内，宿主以手动 Popover 放入顶层，避免目标页面 `transform`、`filter` 等影响固定定位。消息在扩展上下文中传递，Background Service Worker 负责连通性响应；没有向网页全局变量暴露消息总线。

后续仅建议从 L3 自定义控件扫描、L4 API 数据源扫描，再到 L5 业务 Schema；本阶段没有实现 API Client、查询模板、自动填写、审批或发文。
