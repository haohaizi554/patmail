# PatMail Chrome Extension

第一阶段浏览器基础框架：在普通网页右侧显示粉白淡紫浮窗，读取 DOM 并返回结构化数据。
使用 Manifest V3、Vue 3、TypeScript 和 Vite，无 React、jQuery 或后端依赖。

## 安装与构建

推荐 Node.js 22.12+ 或 24 LTS（也支持 Node 20.19+）。进入本目录：

```sh
cd patmail-extension
npm install
npm run build
```

若当前 Codex 环境只有 `pnpm` 而没有 `npm` 命令，可用 `pnpm dlx npm@11 install` 和
`pnpm dlx npm@11 run build`；本次构建使用了这一等价入口。已有 `dist` 可直接加载。

构建先执行 `vue-tsc`，检查 TypeScript 与 Vue 模板，再生成 `dist/`。
`package-lock.json` 固定依赖版本，干净环境也可用 `npm ci` 安装。

## Chrome 加载

1. 使用 Chrome 114 或更新版本，打开 `chrome://extensions/`，开启右上角「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本项目的 **`dist` 文件夹**，不要选择源码目录。
3. 打开一个普通 HTTP/HTTPS 网页；已打开的网页需刷新一次。
4. 页面右侧自动出现 PatMail 浮窗，点击「扫描页面」查看数量，点击「查看 DOM」查看完整 JSON。
5. 拖动标题栏移动浮窗；「−」收起，「×」关闭。关闭后可以点击 Chrome 工具栏的 PatMail 图标，再点「打开浮窗」；刷新网页也会重新出现。

修改源码后重新执行 `npm run build`，在扩展管理页点击刷新扩展，再刷新业务网页。
插件需要 Chrome 扩展环境，直接打开 Vite 网页不能提供 `chrome.runtime` 等扩展 API。

Chrome 内部页、Chrome Web Store 等受保护页面不支持注入。本地 `file://` 页面需要在扩展详情中开启「允许访问文件网址」。这些限制不等同于构建失败。
参考 [Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)。

## 项目目录

```text
patmail-extension/
├── manifest.json                 # MV3 权限、入口和自动注入
├── package.json / package-lock.json
├── tsconfig.json
├── vite.config.ts                # Popup + Background，复制 manifest
├── vite.content.config.ts        # 单文件 IIFE Content Script
├── vitest.config.ts
├── src/
│   ├── background/index.ts       # Service Worker 消息响应
│   ├── content/
│   │   ├── index.ts              # 页面初始化、统一请求处理
│   │   ├── scanner.ts            # 只读 DOM 采集
│   │   └── injector.ts           # Shadow DOM 挂载、卸载
│   ├── floating/
│   │   ├── main.ts               # Vue 挂载与依赖注入
│   │   ├── App.vue               # 浮窗与 JSON 预览
│   │   ├── usePanelDrag.ts       # 拖动、边界、事件清理
│   │   └── style.css
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── App.vue               # 扫描活动标签页、打开浮窗
│   ├── shared/
│   │   ├── types.ts              # 页面与控件类型
│   │   ├── message.ts            # 消息协议与通道类型
│   │   └── guards.ts             # 未知负载运行时校验
│   ├── utils/runtime.ts          # 后台通信与失效处理
│   ├── api/README.md             # 后续接口模块预留
│   ├── rules/README.md           # 后续规则引擎预留
│   ├── automation/README.md      # 后续自动化模块预留
│   └── services/api.ts           # 类型占位，无请求实现
├── tests/
│   ├── scanner.test.ts
│   ├── message.test.ts
│   ├── extension.e2e.mjs         # 真实 Chromium 加载 dist 验收
│   └── fixtures/page.html        # 可重复使用的本地验收页
├── docs/phase-one-plan.md
└── dist/                         # 构建后加载到 Chrome
```

## 已实现

- 顶层页面 `document_idle` 自动注入，刷新后重新出现。
- 页面只增加 `patmail-root` 宿主，浮窗节点和 CSS 在 ShadowRoot 内；宿主不占页面布局。
- 宿主使用手动 Popover 进入浏览器顶层，避免网页 `transform` 等样式使浮窗随页面滚出视口；无全页遮罩。
- 默认 360×600 浮窗，支持拖动、收缩、关闭、重新打开；小视口自适应，拖动与缩放后保持在可见范围。
- 运行状态、当前 URL、页面标题、input/select/button 数量，以及完整结构化 JSON。
- Popup、Content Script、浮窗、Service Worker 统一消息信封与严格类型检查。
- DOM 扫描不填写、不提交、不触发网页按钮；不上传或持久保存扫描结果。

## 消息与数据流

```text
网页 DOM ← Content Script ← MessageBridge → Vue Floating Panel
                 ↕ chrome.tabs.sendMessage
               Popup
                 
Content Script / Popup ↔ chrome.runtime.sendMessage ↔ Background
```

浮窗和 Content Script 运行在同一个扩展隔离环境，用依赖注入的异步 `MessageBridge` 通信；
无需把扩展消息暴露给网页全局事件。跨扩展上下文使用 Chrome 原生消息 API。
参考 [Chrome Message Passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)。

| 请求 | 响应 | 作用 |
| --- | --- | --- |
| `SCAN_PAGE` | `SCAN_RESULT` | 扫描当前顶层页面 |
| `GET_PAGE_INFO` | `PAGE_INFO` | 读取 URL、标题、hostname |
| `SHOW_PANEL` | `PANEL_SHOWN` | 打开浮窗，已打开时不重复创建 |
| `PING` | `PONG` | 验证后台通信 |
| 请求失败 | `ERROR` | 携带可显示的错误信息 |

```ts
{ type: 'SCAN_PAGE' }
// 返回：
{
  type: 'SCAN_RESULT',
  payload: {
    url: 'https://example.com/',
    title: '示例页面',
    hostname: 'example.com',
    inputs: [],
    selects: [],
    buttons: []
  }
}
```

扫描约定：

- `inputs` 包含普通 `input` 与 `textarea`，以 `tag` 区分，数量为两者合计。
- `input[type=button|submit|reset|image]` 与原生 `button` 归入 `buttons`，不重复计数。
- `selects` 返回当前值与全部选项文本。
- 密码和文件控件保留结构，`value` 留空；其他控件读取当前 `.value`。
- 每次扫描读取最新 DOM；插件自己的 Shadow DOM 不计入结果。
- 本阶段不穿透 iframe 或网页自有 Shadow DOM，不识别自定义控件、业务字段和模板。

## 验证命令

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

端到端测试启动临时本地验收服务和独立 Chromium 配置，不使用日常浏览器配置。
测试实际加载 `dist/manifest.json`，检查自动注入、消息、扫描、拖动、关闭和刷新，并生成 `test-results/patmail-panel.png`。
还会回归测试网页 body 带 transform 时的滚动定位、拖动和重新打开。
构建后的文件体积与实际测试结果以命令输出为准。

## 第二阶段建议

1. 在扫描结果上增加字段候选识别：label、控件关联、稳定定位方式，先让用户确认映射。
2. 保存与加载历史查询模板：先定义本地版本、模板迁移和覆盖优先级。
3. 增加客户模板继承：公共模板 → 客户覆盖，显示继承来源和冲突。
4. 根据仓库 `API/03-历史查询条件.md`、`API/04-文件查询.md`、`API/05-文件查询字段映射.md` 接入明确的查询接口。

接口文档中的未确认参数应单独验证；自动填写、提交、文件下载、发邮件和规则执行不在本阶段实现。
