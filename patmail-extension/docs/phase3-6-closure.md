> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.6 收口

Phase 3.6 的查询运行、字段来源和持久化结果仍然有效。Phase 3.7 修正了其中四项已经在源码里复现的缺口：

- 同一页相同 `fileId`、业务字段不一致时，汇总索引把 `conflict` 清成 `false`，会话仍是 `ACTIVE`，文件仍能得到 `SEARCH_RESPONSE_OBSERVED`。
- 会话 `expiresAt` 在翻页时整体后移，旧页文件继续被当作有效证据。
- `MEMORY_ONLY` 可以和 `SEARCH_RESPONSE_OBSERVED` 同时成立，任务没有单独记录证据能否恢复。
- 观察失败只返回 `null`。无效 continuation 仍可能把查询结果显示成没有新来源说明的成功结果。

字典名称唯一匹配不再写成“发文参数已验证”。`identityGate` 进入阶段计划。`dist.pem` 不再进入源码白名单包。

生产邮件写开关和生产流程写开关保持关闭。
