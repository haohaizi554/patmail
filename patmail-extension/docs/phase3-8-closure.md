> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.8 收口

Phase 3.8 把磁盘恢复和任务上的证据时间分开了。复测源码后仍有四个缺口：

- 当前查询已经不再包含文件 A，已保存任务仍可能因为自己的 `evidenceExpiresAt` 未到而保持 `FRESH`。
- 一份文件是 `PERSISTED`、另一份没有 `persistence` 时，聚合会滤掉缺失值，任务整体变成 `PERSISTED`。
- 一份文件有有效期、另一份没有 `evidenceExpiresAt` 时，聚合只检查有时间的文件，任务可以变成 `FRESH` 且不要求重新核验。
- `pack:source` 和 `pack:delivery` 能排除私钥，但手工打的整个工程压缩包仍会带上工作区里的 `dist.pem`。

生产邮件写开关和生产流程写开关保持关闭。
