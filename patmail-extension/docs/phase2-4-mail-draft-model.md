# Phase 2.4 草稿模型

`MailDraftPreview` 是 PatMail 在浏览器里算出的核对结果。它不是 EASY 已经创建的邮件。

## 选择

`SelectedPatentFile` 从 `PatentFile` 显式拷贝：

| PatMail | EASY 查询行 |
|---|---|
| `fileId` | `file_id` |
| `fileName` | `file_name` |
| `fileDescription` | `file_desc` 的显示文本 |
| `customerName` | `customer_name` |
| `caseId` | `case_id` |
| `caseVolume` | `case_volume` |
| `applicationNo` | `app_no` |

`customerProfileId` 只来自用户绑定。选择、全选、取消和跨页都以 `fileId` 为键。

`SelectionSnapshot` 包含 `selectedAt`、文件副本和当时的 `configVersion`（即规则 `revision`）。

## 分组

`planMailGroups` 按文件 ID 排序后处理。同一 `fileId` 只进入一个草稿。组 ID：

- 合并：`merge:{customerIdentity}:{descriptionIdentity}`
- 单发：`single:{profileId}:{fileId}`

组内文件再按 `fileId` 的 UTF-16 码元排序。组之间按客户身份、描述身份、组 ID 的同样顺序排序。相同输入得到相同分组。每个组带上策略版本。

跳过的文件单独变成 `blocked` 草稿，不并进其他组。

## 预览

`planDrafts` / `buildDraftPreview` 输出：

- 客户配置 ID、文件 ID 和文件副本
- 发文类型 GUID 与显示名
- 收件人、抄送、主题、正文、签名
- `sendMode`
- `status`：`ready`、`warning`、`blocked`
- `issues`：`code`、`severity`、`message`、`field`、`draftId`
- `ruleVersions`：策略、映射、收件人、签名、标题、正文的版本

## 校验

`validateDraft` 至少检查：文件 ID、重复文件、跨客户、客户身份、文件描述、发文类型映射、收件人、主题。邮箱、未解析变量、标题需要确认、规则 revision 变化由规划阶段先写入 issues。存在 `error` 时为 `blocked`，只有警告时为 `warning`，否则为 `ready`。`blocked` 不能进入后续真实发文；本阶段也没有真实发文入口。
