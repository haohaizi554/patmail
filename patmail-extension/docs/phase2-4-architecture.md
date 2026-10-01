> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.4 架构

日期：2026-09-24。范围是发文规则、文件分组和 PatMail 本地草稿预览。不调用发文写接口。

## Existing Architecture Audit

审计依据是当前目录和类型，不是重新设计。

运行底座仍是 Chrome MV3 + Vue 3 + TypeScript + Vite。Content script 通过 `MessageBridge` 把只读请求交给 `EasyRuntime`。`EasyTransport` 按操作白名单固定 path 和 `Call`，没有任意 Call 代理。

| 目录 | 已有职责 |
|---|---|
| `src/api/` | 会话 `GetUserModel`、文件查询 `GetSearchFiles`、历史模板 `SearchQueryHisList`、字典 |
| `src/api/file-search-types.ts` | `PatentFile` 有 `fileId`、`fileName`、可选 `fileDescription`、`customerName`、`caseVolume`、`applicationNo`、`caseId`。没有客户 ID 或文件描述 ID |
| `src/api/file-search-normalizer.ts` | 只映射文档中的字段，缺 `file_id` 或 `file_name` 的行丢弃 |
| `src/query/` | QueryXml、三层合并、模板加载竞态 |
| `src/customer/` | `CustomerQueryProfile`，存在查询配置包里 |
| `src/schema/` | 查询表单、文件描述树、`resolveFileDescriptionDisplay` |
| `src/storage/query-bundle.ts` | `patmail.query.v1:{origin}:{userId 或 unscoped}` |
| `src/floating/` | 文件查询、模板、文件描述树、扫描 |
| `src/shared/message.ts` | 消息类型和字典请求校验 |

Phase 2.4 在此之上新增 `src/mail/`。规则计算是纯函数，不写进 Vue。发文配置使用独立的 `MailRuleBundle`，不写入 `QueryBundle`。

`GetSearchFiles` 仍只有一套。`LoadMailType` 是本阶段新增的只读白名单项：`POST /AjaxServers/Common.ashx`，`Call=LoadMailType`，`log_pagename=FileSearchMail.aspx`。节点保留 `id`、`name`、`pid`、`TreeType`。不是 GUID 或缺少名称的节点被忽略，不会生成虚构 GUID。响应不是数组时整次失败。

## 数据流

```text
GetSearchFiles
  → PatentFile[]
  → 按 fileId 选择
  → SelectedPatentFile[]
  → 用户绑定 CustomerQueryProfile
  → 生成不可变 SelectionSnapshot
  → CustomerMailPolicy + DescriptionMailTypeMapping
  → planMailGroups
  → resolveRecipients + buildSubject + buildBody
  → MailDraftPreview[]
  → validateDraft
  → 浮窗预览
```

选择集放在页面内存，键是文件 ID。翻页和新查询不按数组下标改写它。点击「生成发文计划」时，`planDrafts` 使用当时的文件副本和 `MailRuleBundle.revision`。之后改查询结果不会改这份快照；规则 revision 变化会标成 `STALE_RULE`，需要重新生成。

## 存储

发文配置键只在用户 ID 是 GUID 时存在：`patmail.mail.v1:{origin}:{userId}`。没有 GUID 时配置只留在当前 `MailRuleRepository` 实例内存，界面标明「本次页面」。读取和导入都要求 `ownerId` 与当前用户一致。签名的 `operatorId` 也必须是当前用户。损坏、版本不符、归属不符，或出现 cookie / password / authorization 字段时，配置只读，保存抛错，不覆盖原键。更新串行排队，每次成功保存让 `revision` 加一。

查询模板仍可能落在 `unscoped`。发文配置不会读那个键，也不会把一个账号的发文规则套到另一个账号。

## 字典缓存

`DictionaryCache` 为每个键维护世代。进行中的同世代请求会合并。强制刷新或失效会增加世代并丢掉已完成缓存。旧请求返回时，世代已经变化就不写回。用户切换、登录失效、强制刷新和文件描述案件类型切换都走这条失效路径。
