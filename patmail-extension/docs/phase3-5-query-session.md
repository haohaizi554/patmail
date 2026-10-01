> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.5 查询会话

## 调用链

```
SearchFiles
  → SearchFilesResult
  → rememberObservedSearch
  → observeSearchPage
  → FileQuerySession
```

`rememberObservedSearch` 只在 `forward` 收到成功的 `SearchFilesResult`，并且当前连接已经冻结为已登录账号时记录。响应页码、页大小必须和请求一致，结果必须已经通过现有文件查询解析。

生成计划时不读取页面上的业务字段作为事实：

```
createTaskPlan
  → resolveSelectedFiles
  → planTrustedTask
  → buildTask
```

## 指纹

`canonicalFileSearchQuery()` 只序列化真正影响 `GetSearchFiles` 的业务字段，再做 SHA-256。

没有 `resolvedFields` 时，字段是：

- `case_volume`
- `app_no`（去掉点号）
- `customer_name_vague`
- `file_name`
- `filetype`

有 `resolvedFields` 时，只纳入文件查询业务字段。`pageIndex`、`pageSize` 以及系统字段不进入指纹，所以同一条件的不同页属于同一个会话。

指纹不包含 Cookie、Token 或密码。

## 隔离

会话键：

`easyOrigin + operatorId + easyTabId + connectionVersion + queryFingerprint`

切换 EASY 用户、绑定标签页、连接版本、查询条件，或会话超过 30 分钟，旧快照不能再用于新的发文计划。

## 跨页

同一会话内按 `pageIndex` 保存每一页。后一页不会覆盖前一页。

同一个 `fileId` 在该会话里再次出现，且名称、描述、客户、案件 ID、文号或申请号不同：保留第一次观测，标记 `conflict`。不使用后一次覆盖，也不挑选其中一条作为更高可信度。

多个会话都能覆盖同一次选择时，只有业务字段完全一致才采用最近更新的那个会话。字段不一致时，这些文件保持 `FILE_SOURCE_UNVERIFIED`。

没有任何一个会话包含全部所选文件时，各文件仍可保留自己的观测来源。任务级来源不会把这些会话拼成一份可信列表。
