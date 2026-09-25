# Phase 2.5 交付报告

日期：2026-09-26。本阶段在现有插件上完成邮件创建和保存的闭环代码后停止。没有开始 Phase 2.6。

## 已实现

- Phase 2.4 的客户绑定确认、描述映射冲突和预览指纹失效。
- EASY 邮件模型与 PatMail 本地预览分开。
- `MailCustomer`、邮件页只读请求、`SaveMailInfo`、`SaveMailRalteCaseFile` 的参数构建和响应校验。
- 字段差异。未知的 `mailset_id`、`message_id` 等字段不会被置空。
- 执行状态机、本地执行记录，以及创建或保存结果未知时禁止自动重试。
- 浮窗执行面板：确认创建、阶段、mail_id、差异、确认保存、只读复核。
- 写操作默认关闭。单发、响应正文和关联文件格式未核对的分支不能打到真实 EASY。

## 测试

`pnpm test`：13 个文件、102 项通过。`pnpm typecheck` 通过。`pnpm build` 通过，产物仍是 `dist/popup.js`、`dist/content.js`。

没有在真实 EASY 会话里创建或保存邮件。

## 仍不能当成真实成功的部分

- `MailCustomer` 响应正文未保存。代码只按页面条件读取 `objid`。
- `SaveMailInfo` 响应正文未保存。代码只按页面条件读取 `ClientInfo.Status`。
- 单发 `mailstyle` 未知。
- `SaveMailRalteCaseFile` 抓包中的 `file_ids` 为空。生产环境不发送非空值。
- `GetMailInfo` 的已核对字段里没有 `message_id`。缺少该键时保存会被拦住。

## Definition of Done

- [x] Phase 2.4 P0 修复。
- [x] 客户绑定、描述映射和草稿失效。
- [x] 邮件只读接口和标准模型。
- [x] 字段映射与差异预览。
- [x] 创建、保存、关联和复核的请求与状态机。
- [x] 写操作默认关闭，未验证分支不能执行。
- [x] 用户确认后才写入；未知结果不自动重试。
- [x] Typecheck、build 和测试通过。
- [x] 文档完整。
- [ ] 真实 EASY 创建和保存。保持禁用。

## 下一阶段

未开始。流程提交和发送不在本阶段。
