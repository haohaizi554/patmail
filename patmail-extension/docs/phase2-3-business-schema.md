# Phase 2.3 业务 Schema

字段定义在 `FILE_SEARCH_SCHEMA`。表单按这份描述渲染，不在页面里再写一套字段名单。

| 字段 | 控件 | 值 | 字典 | 依赖 |
|---|---|---|---|---|
| `case_type` | 单选 | 内部 ID | `CaseType` | |
| `filetype` | 树，多选 | GUID 列表 | 文件描述树 | `case_type` |
| `file_status` | 单选 | 内部代码 | `FileStatus` | |
| `customer_name_vague` | 文本 | 文本 | | |
| `case_volume` | 文本 | 文本 | | |
| `post_s` / `post_e` | 日期范围 | 日期 | | |
| `file_name` | 文本 | 文本 | | |
| `app_no` | 文本 | 文本 | | 更多条件 |
| `fileclass` | 单选 | 内部代码 | 当前环境已核对的 `general` | 更多条件 |
| `country` | 单选 | `value` | `Country` | 更多条件 |
| `apply_type` | 单选 | 内部 ID | `ApplyType` | 案件类型 |
| `business_type_id` | 单选 | 内部 ID | `BussType` | 案件类型 |
| `case_status` | 单选 | 内部 ID | `CaseStatus` | 案件类型，且 `status_class` 为 `ALL` 或 `CASE` |
| `proc_status` | 单选 | 内部 ID | `ProcStatus` | 更多条件 |
| `flow_direction` | 单选 | 内部代码 | `Case_direction` | 更多条件 |
| `is_close` | 勾选 | `1` 或空 | | 更多条件 |

客户内部 ID 没有可靠的下拉数据源，查询继续用 `customer_name_vague`。不会按客户名称生成 GUID。

`fileclass` 目前只有 API/04 核对过的环境默认值，不是完整字典。历史模板里出现其他代码时显示「未识别的历史 ID」，不改成 `general`。

案件类型变化后重新加载文件描述树。手工查询会去掉不属于新案件类型的已选描述。历史模板里的未知 ID 保持原值，并显示「未识别的历史 ID」。

查询范围：

- 精确定位：文号、申请号、附件名、公开号等文本。
- 业务筛选：客户名称、客户代码、文件描述、申请类型、国家、处理事项、业务类型。
- 日期：`_s`、`_e`、`_start`、`_end`。
- 状态和布尔：文件状态、结案、各类 `is_`、空值勾选。
- 系统默认：案件类型、文件来源，以及分页和 `Call`。

只有前三类中有非空值才允许查询。空字符串覆盖规则不变：临时覆盖高于客户覆盖，客户覆盖高于基础模板。
