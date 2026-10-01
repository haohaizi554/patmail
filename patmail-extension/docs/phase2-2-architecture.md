> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.2 架构

Phase 2.2 在 Phase 2.1 的 `EasyRuntime` 上增加历史查询模板读取、QueryXml 解析、本地模板、客户覆盖和三层合并。文件查询仍走原来的 `GetSearchFiles`。

## 请求边界

`EasyTransport` 白名单新增一项：

| 操作 | Handler | Call |
|---|---|---|
| `session` | `Login.ashx` | `GetUserModel` |
| `fileSearch` | `CaseInfo.ashx` | `GetSearchFiles` |
| `historyQuery` | `CaseInfo.ashx` | `SearchQueryHisList` |

`Call` 必须与路由完全一致。`SearchQueryHisSave`、`SearchQueryHisDelete` 以及其他写接口不能从这套客户端发出。页面消息不能指定 URL 或任意 Call。

历史列表请求固定为：

```text
Call=SearchQueryHisList
query_type=FileSearch
query_id=
log_pagename=FileSearch.aspx
```

指定模板时只替换 `query_id`，并且必须是 GUID。期限监控的 `query_type` 本阶段不使用。

## 模块

```text
src/api/query-history/     列表、详情、60 秒内存缓存
src/query/                 XML 解析、字段分类、三层合并
src/customer/              客户查询配置
src/storage/query-bundle.ts
src/floating/QueryTemplateSection.vue
```

`EasyRuntime` 持有同一个 `HistoryQueryService`。登录检测得到的 `user_id` 变化、退出登录或 `dispose` 时清空这份缓存。缓存只在内存中，刷新页面即失效；界面上的「刷新历史模板」会强制再请求一次。

## 数据流

```text
SearchQueryHisList
    → Options / QueryXml 归一化
    → DOMParser 解析 xmlRoot
    → 字段注册表分类
    → 基础模板 + 客户覆盖 + 临时覆盖
    → buildGetSearchFilesFromFields
    → 原有 GetSearchFiles
```

手动查询不经过这条链路。`FileSearchQuery.resolvedFields` 缺省时，仍使用 Phase 2.1 的 `buildGetSearchFilesParams`。

## 本地存储

仓库接口是 `QueryTemplateRepository` 和客户仓库。当前实现把模板和客户放在同一个版本包里：

```text
patmail.query.v1:{origin}:{userId 或 unscoped}
```

`user_id` 必须是 GetUserModel 返回的 GUID。拿不到 GUID 时使用 `unscoped`，界面会说明这份数据没有按账号分开。版本不是 `1` 或结构损坏时，读取返回空包并给出警告，不回写覆盖原数据。

只有 `source: 'local'` 的模板可以保存或删除。从 EASY 导入会新建一个本地 ID，并记下 `sourceQueryId`。之后刷新原网站列表不会改这份副本。

## 会话与分页

历史接口和文件查询都要求当前 `EasyRuntime` 会话为已登录。分页按钮复制上一次 `FileSearchQuery`。模板查询的上次查询里带有 `resolvedFields`，翻页不会退回手动输入框。

## 本阶段不做

不实现历史模板写回、邮件、审批、下载、字典系统、FastAPI 或数据库。Phase 2.3 预留的接口名只出现在交付报告中。
