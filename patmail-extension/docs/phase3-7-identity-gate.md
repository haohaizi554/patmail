> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.7 身份门禁

`TaskIdentityGate` 进入 `buildStagePlans()`。

| 条件 | 阶段结果 |
| --- | --- |
| `FILE_SOURCE_UNVERIFIED` | 写阶段增加“文件来源尚未经查询响应确认。”写阶段 `canExecute` 保持 false |
| `MEMORY_ONLY` 或 `FAILED` | 写阶段增加“查询来源尚未持久化，执行前需要重新核验。” |
| `mixedQuerySession` | 写阶段不能执行 |
| 文件描述内部 ID 未验证 | `DESCRIPTION_MAPPING` 和涉及该 ID 的写阶段阻塞 |
| EASY 客户 GUID 未确认 | `MAIL_CREATE`、`MAIL_SAVE` 阻塞 |
| 任务状态 `BLOCKED` | 依赖未满足的业务阶段不再显示为可执行。`FILE_QUERY`、`MAIL_READ`、`WORKFLOW_READ` 等只读诊断阶段保留入口 |

写阶段继续全部关闭。写开关没有打开。

## 文件描述

`LoadFileTypeByCaseType` 的节点保留 `id`、`name`、`pid`、`seq`、`tree_level`。响应里的 `TreeType` 原样记到 `treeType`。契约只说明本次有两种长度为 4 的值，没有说明哪个值表示可选，因此不用 `TreeType` 推断能否发文。

名称完全一致且节点 ID 唯一，只表示字典文本已经对上。没有明确的可选标记，或者节点仍有子节点时，结果是“已解析，业务可选性待确认”：`selectable = pending`，`verified = false`。内部 ID 不会被复制成已验证的发文参数。只有调用方明确给出叶子节点 `selectable: true` 时，才是 `confirmed`。当前树构建不会自动给出这个标记。
