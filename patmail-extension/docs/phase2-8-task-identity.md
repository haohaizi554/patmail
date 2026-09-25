# Phase 2.8 任务身份

日期：2026-09-26。

## taskId 与 taskFingerprint

`taskId` 是任务实例。每次 `buildTask` 调用 `crypto.randomUUID()`。

`taskFingerprint` 是业务输入的 SHA-256 十六进制摘要。同一份规范化输入得到同一个指纹，两次生成得到两个任务编号。

旧实现 `task-${fingerprint.slice(0, 24)}` 已从任务构建中移除。指纹以站点和操作员开头，截取前缀会让不同文件集合撞成同一个编号。

摘要实现是 `src/automation/sha256.ts` 的同步 SHA-256。已知向量：`sha256("abc")` 为 `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`。构建和校验保持同步，不把摘要放到异步 Web Crypto 里。日志和界面使用摘要或 UUID，不使用完整原始业务串当编号。

## 指纹内容

规范化对象按键名排序后序列化。文件按 `fileId` 排序，因此同一集合的不同传入顺序得到同一指纹。

摘要至少包含：

- `origin`、`operatorId`
- 每个文件的编号、名称、描述、描述 GUID、客户编号、客户绑定
- 发文方式、发文类型映射
- 收件人与抄送
- 标题规则、正文规则、签名内容
- 规则 `revision` 以及上述规则字段的实际内容
- `queryTemplateVersion`

只改 revision 不够。签名正文、收件人、文件描述、模板版本、客户绑定的变化都会改变摘要。校验时用任务上冻结的 `ruleSnapshot` 和 `selectedFiles` 重算，再与当前配置的摘要比较。内容不一致则进入 `STALE`。调用方传入的指纹字符串不会被采用。

## 多客户

`customers` 收集每个 `TaskItem` 的客户。多于一位时，任务名称和 `customerName` 为“多个客户”，`customerProfileId` 为空。每个子任务仍保存自己的 `customerProfileId`。

## 旧任务迁移

`migrateTask` 对已经是 UUID 的编号不再换号。

对旧的非 UUID 编号：

- 生成新的 UUID。
- `legacyTaskId` 保留旧编号。
- 迁移记录写入 `{ from, to, at }`。
- 子任务上的 `easyMailId` 原样保留。
- 状态为 `UNKNOWN`、子任务为 `UNKNOWN`，或检查点 `requestSent` 且尚未核验时，迁移后仍是 `UNKNOWN` 且 `readonly`。

缺少编号或子任务数组、无法可靠识别的记录不换号，只读保留。损坏对象进入 `opaque`，提交时原样写回，不删除。带 `cookie`、`authorization` 或 `password` 字段的包整包丢弃，避免把凭据写进任务库。

重新读取不会把 `UNKNOWN` 改成 `READY`。已发出请求的恢复只读，保留 `easyMailId`、`mailExecutionId`、`workflowExecutionId`、检查点和 `requestSent`。
