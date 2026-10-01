> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.4 查询依赖

## 摘要编码

`stableFieldDigest` 使用：

```text
JSON.stringify(Object.keys(fields).sort().map(key => [key, fields[key]]))
```

然后再做 SHA-256。空字符串保留。缺字段和空字符串摘要不同。换行、回车、等号和中文不会把两组不同字段编成同一摘要。属性顺序不同、语义相同的对象摘要相同。

回归样本：

- `{ a: "x\nb=y" }` 与 `{ a: "x", b: "y" }` 摘要不同。
- 含 `\n`、`\r`、`=` 和 Unicode 的值不会与拆开的字段撞摘要。

## 依赖范围

任务选中的文件先确定 `customerProfileId` 和 `customerBinding.profileId`。`buildQueryDependencies` 只冻结这些客户及其基础模板。其他客户的模板变化不会使当前任务变成 `STALE`。

被引用客户的基础模板变化、客户被删除、或该客户 `overrides` 变化，都会使任务 `STALE`。

## 旧任务

`queryDependencies` 缺失时，校验写入 `LEGACY_DEPENDENCY_UNKNOWN`，任务只读，状态为 `STALE`。已有 `UNKNOWN` 或已发送请求的任务保持 `UNKNOWN` 只读。

这类任务可以查看和做只读诊断，不能带着缺失依赖进入真实写操作。新计划始终写入依赖数组，状态为 `CURRENT`。
