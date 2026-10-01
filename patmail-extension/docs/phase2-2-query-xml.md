> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.2 QueryXml

依据是 [API/03-历史查询条件.md](../../API/03-历史查询条件.md) 和 [API/05-文件查询字段映射.md](../../API/05-文件查询字段映射.md)。本阶段没有重新抓包。

## 列表与详情

`SearchQueryHisList` 的业务体是：

| 原始字段 | PatMail |
|---|---|
| `Options` 为 `null` 或 `[]` | 空列表，成功 |
| `Options[].query_id` | `HistoryQueryOption.id`，保留 GUID |
| `Options[].title` | `HistoryQueryOption.name` |
| `QueryXml[0].query_xml` | `HistoryQueryDetail.queryXml` |

缺少 `Options`、`Options` 不是数组，或某一项没有 GUID `query_id` / 非空 `title`，返回 `INVALID_RESPONSE`，不补造模板。`QueryXml` 缺失或 `query_xml` 为空，返回 `INVALID_QUERY`（未找到该历史模板）。

详情响应里的 `Options` 为 `null` 时，不把内存中的列表缓存改写成空数组。标题优先用详情里的 `title`；详情没有标题时，使用同一用户缓存里的列表名称。两边都没有标题则返回 `INVALID_RESPONSE`，不编造名称。

`ClientInfo.IsLogin === false` 为会话失效。`Status === false` 为业务错误。`Result === false` 且 `Status === true` 仍视为可读成功，与 Phase 2.1 一致。

## 解析

`parseQueryXml` 使用 `DOMParser`，MIME 为 `application/xml`。

拒绝：

- 空白 XML
- 长度超过 200000 字符
- 含 `DOCTYPE`、`ENTITY`、`ELEMENT`、`ATTLIST`
- `parsererror`
- 根节点不是 `xmlRoot`
- `xmlRoot` 直接子节点超过 500 个

不使用正则拆节点，不执行 XML，不把 XML 插入页面。

## 字段

值字段写入 `fields`。以 `_text` 结尾、且去掉后缀后能对应到注册字段的节点写入 `displayValues`，不进入请求。`API/05` 的 16 个控件名改写复用在 `XML_NODE_TO_API`，例如 `selfileclass` → `fileclass`、`txtpost_s` → `post_s`。其余节点名只有出现在 Phase 2.1 的 `FILE_SEARCH_REQUEST_FIELDS` 业务字段中才进入 `fields`。

注册表之外的节点进入 `unknownFields`，并写入警告（来源模板名、字段名）。合并和 `GetSearchFiles` 都不会发送它们。

空元素保留为空字符串，表示模板明确把该条件置空。重复的值节点保留最后一个，并记录警告。`&amp;` 等实体由解析器解码。

`__proto__`、`prototype`、`constructor` 被丢弃。
