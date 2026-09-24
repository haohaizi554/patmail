# Phase 2.3 架构

本阶段在同一套 `EasyTransport` 上增加五条只读路由，并把文件查询表单改成由 Schema 驱动。没有第二套请求客户端，也没有第二份 116 字段表。

## 新增路由

| 操作 | Handler | Call | 额外参数 |
|---|---|---|---|
| `basicData` | `CaseInfo.ashx` | `IPGetBasicData` | `log_pagename=FileSearch.aspx` |
| `flowDirection` | `CaseInfo.ashx` | `GetFlowdirection` | 同上 |
| `fileTypeTree` | `Common.ashx` | `LoadFileTypeByCaseType` | `official=1`，`case_type` 为 GUID，`file_type` 为空 |
| `fieldColumn` | `PatentAction.ashx` | `GetFieldColumn` | `log_pagename=FileSearch.aspx` |
| `listColumn` | `Common.ashx` | `LoadListColumn` | `belong_key=CaseInfo.ashx_GetSearchFiles` |

`Call` 必须与路由一致。页面消息只能选择上述种类，不能提交 URL 或其他 Call。

## 数据流

```text
历史模板 / 手工表单
    → QueryXml 或 Schema 表单
    → 字典解析只负责显示名和选项
    → 客户覆盖
    → 临时覆盖
    → assessQueryScope
    → buildGetSearchFilesFromFields
    → GetSearchFiles
```

字典解析不改写已保存的内部 ID。文件描述提交的是节点 GUID，不是中文名称。

## 缓存

`DictionaryCache` 按用户键和参数缓存归一化结果，默认 10 分钟。同一键的并发请求合并为一次。强制刷新绕过缓存。登录用户变化、退出或 `dispose` 时清掉该用户的字典缓存和已替换的 `colsel`。文件描述树的缓存键包含案件类型 GUID。缓存里没有 Cookie、密码或完整用户模型。

`LoadListColumn` 在返回可用 `show_column` 时，用 `;字段;` 替换当前环境的 `colsel`。空配置或没有可用字段时继续使用 `CURRENT_ENVIRONMENT.colsel`。

## Phase 2.2 收口

- 模板列表和详情共用 `TemplateLoadCoordinator`。新请求会中止旧请求，组件卸载后不再写界面状态。切换客户或账号时先清空当前模板字段。
- `assessQueryScope` 把条件分成精确定位、业务筛选、日期、状态布尔和系统默认。只有前三类里的非空值才能发起查询。`is_close`、文件状态、案件类型和文件来源单独存在时不会打出全库查询。
- 本地配置版本不兼容或含有无法识别的条目时只读，保存会失败且不覆盖原键。模板和客户修改走 `updateBundle`，同一存储键串行更新。
