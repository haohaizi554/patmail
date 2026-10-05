> 来源：2026-10-05 13:17:35–13:35:45（UTC）第一段抓包，主机 `http://183.36.43.66:88`。本文收录该时段内实际出现的请求与响应骨架，不含人名、邮箱、电话及业务长文本。该段 593 条 POST 已分册写入第 14 至 30 号文档，本文为其一册。第二段抓包的新增接口见第 31 至 40 号文档及 [README.md](README.md)。

# 合同 CRM

这些 Call 都打到 `POST /AjaxServers/CRMAction.ashx`。

公共约定见 [00-通用约定.md](00-通用约定.md)。目录见 [README.md](README.md)。

合同列表本身在 [19-客户-资料与合同.md](19-客户-资料与合同.md) 的 `Customer.ashx`。

## CRMAction.ashx GetContractEditFeeAuth

用途推断：编辑合同页按 `contract_id` 查询合同费用编辑权限。

- 抓包次数：1
- 来源页面：`EditContract.aspx`（1）
- Referer：`/forms/CRM/EditContract.aspx`（1）

```http
/AjaxServers/CRMAction.ashx
Call=GetContractEditFeeAuth
contract_id=fe224313-5459-392d-3742-b866bb114d39
log_pagename=EditContract.aspx
```

| 参数 | 出现 | 空值 | 值形态 | 说明 |
|---|---:|---:|---|---|
| contract_id | 1 | 0 | ascii，长度 36 | 示例 `fe224313-5459-392d-3742-b866bb114d39` |
| log_pagename | 1 | 0 | ascii，长度 17 | 示例 `EditContract.aspx` |

响应：1 种骨架 `obj:ClientInfo`，覆盖这 1 次。样本页面 `EditContract.aspx`，186 字节。

- `ClientInfo`：`IsLogin` true，`Status` true，`Result` true，`Message` null。
- 顶层键只有 `ClientInfo`，没有另行的权限字段。
- null 键：无。空数组键：无。无数组长度。

## CRMAction.ashx GetContractInfo

用途推断：编辑合同页按 `contract_id` 读取合同信息，响应键为 `ContractInfo`、`ContractAdv`。

- 抓包次数：1
- 来源页面：`EditContract.aspx`（1）
- Referer：`/forms/CRM/EditContract.aspx`（1）

```http
/AjaxServers/CRMAction.ashx
Call=GetContractInfo
contract_id=fe224313-5459-392d-3742-b866bb114d39
log_pagename=EditContract.aspx
```

| 参数 | 出现 | 空值 | 值形态 | 说明 |
|---|---:|---:|---|---|
| contract_id | 1 | 0 | ascii，长度 36 | 示例 `fe224313-5459-392d-3742-b866bb114d39` |
| log_pagename | 1 | 0 | ascii，长度 17 | 示例 `EditContract.aspx` |

响应：1 种骨架 `obj:ClientInfo,ContractAdv,ContractInfo`，覆盖这 1 次。样本页面 `EditContract.aspx`，226 字节。

- `ClientInfo`：`IsLogin` true，`Status` true，`Result` false，`Message` null。
- 顶层键：`ContractInfo`、`ContractAdv`、`ClientInfo`。
- `ContractInfo`、`ContractAdv` 均为 null。null 键：`ContractInfo`、`ContractAdv`。空数组键：无。无数组长度。

## CRMAction.ashx GetContractVoidEditAuth

用途推断：编辑合同页按 `role_id` 查询合同作废编辑权限，响应对象为 `EditAuth`。

- 抓包次数：1
- 来源页面：`EditContract.aspx`（1）
- Referer：`/forms/CRM/EditContract.aspx`（1）

```http
/AjaxServers/CRMAction.ashx
Call=GetContractVoidEditAuth
role_id
log_pagename=EditContract.aspx
```

| 参数 | 出现 | 空值 | 值形态 | 说明 |
|---|---:|---:|---|---|
| role_id | 1 | 0 | text，长度 147 | 含中文或长文本，原文未收录 |
| log_pagename | 1 | 0 | ascii，长度 17 | 示例 `EditContract.aspx` |

响应：1 种骨架 `obj:ClientInfo,EditAuth`，覆盖这 1 次。样本页面 `EditContract.aspx`，217 字节。

- `ClientInfo`：`IsLogin` true，`Status` true，`Result` false，`Message` null。
- 顶层键：`ClientInfo`、`EditAuth`。
- `EditAuth` 为对象，字段 `authority`（字符串，样本 `RC`，长度 2）。
- `Result` 为 false，`EditAuth` 仍有 `authority`。
- null 键：无。空数组键：无。无数组长度。

## CRMAction.ashx GetPerFlag

用途推断：案件、商标、版权三个管理页读取权限标记，响应字段为 `perFlag`。

- 抓包次数：3
- 来源页面：`CaseManage.aspx`（1）、`TradeMarkManage.aspx`（1）、`CopyRightManage.aspx`（1）
- Referer：`/Forms/Patent/CaseManage.aspx`（1）、`/Forms/Patent/TradeMarkManage.aspx`（1）、`/Forms/Patent/CopyRightManage.aspx`（1）

三次都只有 `log_pagename`，页面名不同。

```http
/AjaxServers/CRMAction.ashx
Call=GetPerFlag
log_pagename=CaseManage.aspx
```

| 参数 | 出现 | 空值 | 值形态 | 说明 |
|---|---:|---:|---|---|
| log_pagename | 3 | 0 | ascii，长度 15–20 | 示例 `CaseManage.aspx`、`TradeMarkManage.aspx`、`CopyRightManage.aspx` |

响应：1 种骨架 `obj:ClientInfo,perFlag`，该骨架 count 为 3。样本页面 `CaseManage.aspx`，201 字节。

- `ClientInfo`：`IsLogin` true，`Status` true，`Result` true，`Message` null。
- 顶层键：`ClientInfo`、`perFlag`。
- 样本中 `perFlag` 为布尔值 true。
- null 键：无。空数组键：无。无数组长度。

## CRMAction.ashx LoadFileType

用途推断：客户文件列表页按 `official`、`file_desc` 加载文件描述树，响应数组键为 `FileDesc`。

- 抓包次数：1
- 来源页面：`CustomerFileList.aspx`（1）
- Referer：`/Forms/customer/CustomerFileList.aspx`（1）

```http
/AjaxServers/CRMAction.ashx
Call=LoadFileType
official=1
file_desc
log_pagename=CustomerFileList.aspx
```

| 参数 | 出现 | 空值 | 值形态 | 说明 |
|---|---:|---:|---|---|
| official | 1 | 0 | ascii，长度 1 | 示例 `1` |
| file_desc | 1 | 1 | empty | 本次为空 |
| log_pagename | 1 | 0 | ascii，长度 21 | 示例 `CustomerFileList.aspx` |

响应：1 种骨架 `obj:ClientInfo,FileDesc`，覆盖这 1 次。样本页面 `CustomerFileList.aspx`，182607 字节。

- `ClientInfo`：`IsLogin` true，`Status` true，`Result` false，`Message` null。
- 顶层键：`ClientInfo`、`FileDesc`。
- `FileDesc` 长度 1242。null 键：无。空数组键：无。
- `Result` 为 false，`FileDesc` 仍有 1242 条。
- 元素字段：`seq`（整数，样本 1）、`id`（字符串，长度 36）、`TreeType`（字符串，样本 `Dept`）、`name`（字符串，`<text>`，长度 4）、`pid`（字符串，样本 `0`，长度 1）。

## 本文件接口

| Call | 次数 |
|---|---:|
| `CRMAction.ashx GetContractEditFeeAuth` | 1 |
| `CRMAction.ashx GetContractInfo` | 1 |
| `CRMAction.ashx GetContractVoidEditAuth` | 1 |
| `CRMAction.ashx GetPerFlag` | 3 |
| `CRMAction.ashx LoadFileType` | 1 |
