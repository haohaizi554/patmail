> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.3 字典契约

依据是 [API/02-公共数据.md](../../API/02-公共数据.md)、[API/04-文件查询.md](../../API/04-文件查询.md)、[API/09-期限监控.md](../../API/09-期限监控.md)，以及页面脚本对 `fieldColumn`、`show_column` 的读取方式。本阶段没有重新抓包。

`ClientInfo.Result=false` 且 `Status=true` 时，只要业务数组存在，就按成功处理。`IsLogin=false` 是会话失效。`Status=false` 是业务失败。`null` 数组是空字典，不是接口失败。字段缺失或类型不对的那一组标为 `partial` 或 `invalid`，其他组仍可使用。

## IPGetBasicData

| 响应数组 | 内部值 | 显示名 | 过滤信息 |
|---|---|---|---|
| `CaseType` | `case_type_id` | `case_type` | `case_type_code` |
| `Country` | `value` | `text_zh_cn` | `country_code` |
| `CaseStatus` | `case_status_id` | `case_status` | `case_type_id`、`status_class` |
| `ApplyType` | `apply_type_id` | `apply_type` | `case_type_id`、`country_id` |
| `BussType` | `business_type_id` | `bussType` | `case_type_id` |
| `customer_status` | `customer_status_id` | `customer_status` | `case_type_id` |
| `CtrlProc` | `ctrl_proc_id` | `ctrl_proc` | `case_type_id` |
| `ProcStatus` | `proc_status_id` | `proc_status` | `status_code` |
| `Case_direction` | `value` | `text_zh_cn` | |
| `CaseBranchDept` | `dept_id` | `dept_name` | `parent_id`、`is_enabled` |

没有用数组下标充当 ID。显示名不会被送进 `GetSearchFiles`。

## GetFlowdirection

| 数组 | 内部值 | 显示名 |
|---|---|---|
| `FileStatus` | `value` | `text_zh_cn` |
| `ProcStatus` | `value` | `text_zh_cn` |
| `Case_direction` | `value` | `text_zh_cn` |
| `CaseBranchDept` | 与基础数据相同 | |
| `DownLoadFileName` | `value`（列名代码） | `text_zh_cn` |

文件查询的文件状态优先用这里的 `FileStatus`。`DownLoadFileName` 只保留字典，不实现下载。

## LoadFileTypeByCaseType

`FileType[]` 的 `id`、`name`、`pid`、`seq`、`tree_level` 建成树。`id` 是提交给 `filetype` 的 GUID，多项用逗号连接。根节点的 `pid` 为空。重复 ID 保留第一条。父节点不存在时记为无效父节点并挂到根上。环形子节点会被断开并记诊断。默认不展开整棵树，搜索最多显示 50 条。

## GetFieldColumn

`fieldColumn[]` 使用页面脚本已经读取的 `column_id`、`column_name`，以及文档记录的 `is_enabled`。`column_1` 到 `column_5` 通过现有 XML 改名表变成 `column1` 到 `column5`。`control_name` 有则保留。`is_enabled` 不是布尔值时视为未启用，并给出警告。禁用栏位不出现在可编辑表单里；历史模板里已有的值仍留在查询字段中。

## LoadListColumn

请求的 `belong_key` 固定为 `CaseInfo.ashx_GetSearchFiles`。响应读取 `show_column[].item_value`。有可用列名时生成 `;列名;列名;`。`show_column` 为 `null` 或空数组时不替换环境 `colsel`。
