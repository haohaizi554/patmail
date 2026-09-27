# Phase 3.6 字段来源

可信文件不再通过展开页面对象继承字段。Background 按白名单重建：

- 来自 `GetSearchFiles` 响应：`fileId`、`fileName`、`fileDescription`、`customerName`，以及响应里实际存在的 `caseId`、`caseVolume`、`applicationNo`
- 来自当前账号客户配置，并且绑定的原始客户名与响应一致：`customerProfileId`、`customerBinding`
- 来自唯一的文件描述字典匹配：`fileDescriptionId`

页面提交的 `fileDescriptionId`、`customerId` 和其他未验证 GUID 不会进入可信计划。

响应没有 `caseId` 时保持未知，不用页面上的 `caseId` 补上。当前没有另建按 ID 回读接口。

## 文件描述 ID

`resolveFileDescriptionIdentity` 只在下面条件同时成立时给出内部 ID：

- 描述文本完全一致
- 案件类型是明确的 GUID
- 字典里只有一个同名合法节点
- 节点 ID 是 GUID

多条同名节点时不取第一项。模糊包含不算匹配。无法唯一解析时只保留描述文本，字段来源为 `UNKNOWN`。

字典必须先由 Background 记下。完整页面转发成功的 `LoadFileTypeByCaseType` 结果会按账号和案件类型保存。查询条件里带有 `case_type` 时，计划才能使用这棵树。

## 客户 ID

三个概念分开保存：

- EASY 响应里的 `customerName`
- 用户确认的本地 Profile 和 `customerBinding`
- 经过验证的 EASY 客户 GUID

当前 `GetSearchFiles` 归一化结果没有客户 GUID。本地 Profile 上的 `easyCustomerId` 也不会直接写进文件的 `customerId`。没有可靠的原站客户 ID 来源时，只保留已核对的本地绑定。`customerId` 的字段证据为 `UNKNOWN`，`verified` 为 false。

## 字段证据

每份已观察文件带有 `fieldEvidence`，至少覆盖：

- `fileId`
- `fileDescriptionId`
- `customerId`
- `caseId`
- `customerProfileId`

来源可以是 `EASY_SEARCH_RESPONSE`、`EASY_DICTIONARY`、`EASY_READBACK`、`LOCAL_PROFILE`、`USER_INPUT` 或 `UNKNOWN`。

任务上的 `identityGate` 分别记录文件来源、描述 ID 是否全部已验证、客户 GUID 是否全部已验证，以及是否混用了查询运行。一个 `SEARCH_RESPONSE_OBSERVED` 不代表这些内部身份都已验证。本阶段不产生 `EASY_READBACK` 或 `FILE_READBACK_VERIFIED`。
