> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.5 缺陷收口

日期：2026-09-26。这一轮只收口创建、保存和文件关联的确认方式。真实写操作仍然关闭。

## A1. 保存前必须先看到差异

创建成功后，`loadInto` 会马上 `adaptMailDraft`，把差异和 `diffDigest` 放进执行记录。面板在确认保存之前展示：

- EASY 原始值
- PatMail 计划值
- 最终拟保存值
- 字段来源
- 是否阻塞保存

确认保存时必须带回刚才看到的 `diffDigest`。保存前会再读一次邮件。摘要变了就回到 `MAIL_LOADED`，不调用 `SaveMailInfo`，要求重新查看。

## A2. 同一次选择不能进两次 MailCustomer

同一个 `origin + userId + fingerprint` 在一个 `ExecutionStore` 实例里串行执行。第二次创建会看到已经发出的记录，不再调用 `MailCustomer`。结果未知的记录同样不能自动再创建。

`chrome.storage` 没有事务。两个标签页各有一个执行实例时，两次创建都可能进入 `MailCustomer`。因此生产写开关继续关闭。这个剩余风险写在 Phase 2.6 验收里。

## A3. 指纹由当前选择重算

创建和保存不再接收调用方自带的指纹字符串。运行时用当前用户、当前站点、规则版本，以及调用方给出的文件选择集重新计算指纹，再和预览里的指纹比较。预览里的文件还必须能在这份选择集里找到同一身份。对不上就拒绝，请求不会发出。

## A4. 文件关联未核实时不是完整成功

`SaveMailRalteCaseFile` 的 `file_ids` 格式还没有核对，生产门禁返回 `null`，不调用该接口。邮件已经保存时进入 `BINDING_BLOCKED`。记录保留 `mail_id`、文件集合、已完成步骤和阻塞原因。这个状态会挡住同一指纹的再次创建，也不会显示成 `COMPLETED`。
