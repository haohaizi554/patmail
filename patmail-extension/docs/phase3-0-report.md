# Phase 3.0 报告

## 结果分层

- 完整页面 UI 已迁移。点击图标打开 `app.html`，左侧导航、hash 刷新和深链接可用。
- 真实业务已接入。文件查询走绑定标签页上的 EasyRuntime；客户、规则、任务走现有 Repository。
- Mock / fixture 测试已通过。
- 真实 EASY 会话未验证。浏览器测试拦截了 `http://183.36.43.66:88`，使用 `pm_fixture_session=active` 和用户 `11111111-1111-1111-1111-111111111111`。
- 真实写操作未执行。生产写门禁保持关闭。

## 命令

| 命令 | 结果 |
|---|---|
| `pnpm test` | 18 个文件，139 项通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过。`dist/app.html`、`dist/app.js`、`dist/background.js`、`dist/content.js` 存在，脚本路径是 `./app.js` |
| `pnpm test:e2e` | 14 项浏览器检查通过 |

E2E 在清除代理后运行。新增检查覆盖：无 `default_popup`、同一 `app.html` 不重复创建、刷新后 hash 仍在、未连接时不出现演示客户、fixture 会话检测、fixture 文件查询、Production Write 关闭。旧浮窗检查改为先断言不会自动注入，再发送 `SHOW_PANEL`。

## Definition of Done

- [x] `app.html` 正式入口
- [x] 点击图标打开完整标签页（E2E 调用与 `onClicked` 相同的 `openWorkspaceTab`；无头浏览器不能按真实工具栏）
- [x] 不再默认 Popup
- [x] 不再自动注入业务浮窗
- [x] 根目录视觉迁到完整工作台，缺图使用内联占位
- [x] 完整页面是唯一正式工作台
- [x] 5173 不是运行依赖
- [x] 生产页面不使用 `src/data.js`
- [x] EASY 标签页绑定
- [x] EasyConnectionContext
- [x] FullPageEasyBridge
- [x] 文件查询、客户、规则、任务接到现有模块
- [x] 邮件和工作流状态按未核验规则展示
- [x] 历史任务从后台仓库恢复
- [x] 验收等级不能由 UI 声明
- [x] 本地存储无破坏性迁移
- [x] 原有测试保留并通过
- [x] Typecheck、Build、Full-page E2E
- [x] 生产写门禁关闭
- [ ] 真实 EASY 已登录会话
- [ ] 真实写操作

开发停在这里，没有进入生产自动发文。
