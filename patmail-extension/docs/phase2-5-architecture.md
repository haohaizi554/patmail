# Phase 2.5 架构

日期：2026-09-26。范围是把 PatMail 本地 `MailDraftPreview` 接到 EASY 邮件草稿的创建和保存。不发送、不提交流程、不审核。

## Existing Architecture Audit

运行底座仍是 `patmail-extension/` 里的 Chrome MV3、Vue 3、TypeScript 和 Vite。没有新的 Vue 工程，也没有第二套消息总线。

| 已有目录 | 本阶段怎么用 |
|---|---|
| `src/api/client.ts` | 继续由 `EasyRuntime` 持有会话、查询和字典。邮件执行作为新方法挂在同一个实例上 |
| `src/api/transport.ts` | 仍固定 Origin、Handler、Call 和 POST。新 Call 只增加白名单项 |
| `src/shared/message.ts` | 在原联合类型上增加创建、保存、查找和只读复核。`confirmed` 不是 `true` 的创建或保存消息会被拒绝 |
| `src/mail/` | Phase 2.4 的选择、分组、规则和本地预览保持为纯函数 |
| `src/mail/easy/` | 新增。EASY 邮件快照、契约、读取、创建、保存、状态机和执行记录 |
| `src/floating/MailWorkspace.vue` | 仍负责规则和本地预览。每封预览下面挂执行面板 |
| `src/storage/` | 查询配置包不变。执行记录使用单独的键 |

`MailDraftPreview` 仍是 PatMail 本地计划。`EasyMailSnapshot` 才是从 EASY 读回来的邮件。保存前由 `adaptMailDraft` 对照两者，未知字段不会被写成空字符串。

## 数据流

```text
MailDraftPreview
  → 用户确认创建
  → MailCustomer
  → objid = mail_id
  → MailinfoInit / GetMailInfo / 联系人 / 签名 / 规则 / 文件 / 案件
  → 差异预览
  → 用户确认保存
  → SaveMailInfo
  → SaveMailRalteCaseFile（仅当 file_ids 格式已核对）
  → 再次 GetMailFile
  → COMPLETED 或 PARTIAL_FAILURE
```

内容脚本发起请求，沿用浏览器会话。执行记录只保存业务标识和阶段，不保存 Cookie。

## 写操作门禁

三层都要过：

1. `EASY_MAIL_WRITES_ENABLED` 默认 `false`。页面消息不能把它打开。
2. 合并发文的 `mailstyle=1` 已在抓包出现。单发 `mailstyle`、`MailCustomer` 响应正文、`SaveMailInfo` 响应正文、`SaveMailRalteCaseFile` 的非空 `file_ids` 格式都还没核对。缺任何一项，生产门禁拒绝真实写入。
3. 浮窗先展示客户、发文类型、文件和收件人，用户点「确认创建」或「确认保存」后才发对应消息。打开浮窗、切换模板和查询完成都不会创建邮件。

Mock 测试注入单独的门禁，用来走完创建、保存和复核。这不代表真实 EASY 已经成功。
