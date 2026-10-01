> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.3 模板依赖

`queryTemplateVersionOf` 不再做字符码求和，固定返回 `0`。它不再承担业务变更检测。

每个任务保存 `QueryDependencySnapshot`：

- `customerProfileId`
- `customerRevision`
- `baseTemplateId`
- `templateId`
- `templateVersion`
- `templateContentDigest`
- `customerOverridesDigest`

`templateContentDigest` 和 `customerOverridesDigest` 是查询字段稳定序列化后的 SHA-256。键会排序。空字符串覆盖保留。摘要不使用显示名称，也不使用客户 `updatedAt`。

后台重新读取模板并比较摘要。模板内容不同，任务进入 `STALE`，即使客户编号、名称和 `updatedAt` 都没变。

已核对的情况：

- 文件描述 GUID 从 A 改为 B：过期。
- 空字符串覆盖和缺省字段：摘要不同，会过期。
- 模板删除，或按同一编号重建但内容不同：过期。
- 字段顺序变化但内容相同：不过期。
- 内容不同但长度相同：过期。
- 客户数组顺序变化：不过期。
