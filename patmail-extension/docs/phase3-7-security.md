> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.7 签名私钥

`patmail-extension/dist.pem` 是明文私钥格式的扩展签名文件。它已经被 Git 跟踪，最早出现在提交 `15d5b4e`。历史里已经有这份私钥。如果仓库或旧的交付压缩包曾经分发出去，应把这把密钥视为已经暴露。

本阶段没有删除工作区里的副本，也没有轮换密钥。它可能是当前扩展唯一的签名密钥。轮换会改变扩展 ID，并影响已经安装的扩展和本地数据。所有者应先把副本放到私有位置备份，再自行决定是否用 `git rm --cached patmail-extension/dist.pem` 停止跟踪。停止跟踪需要一次新的提交才会从后续版本里消失，不能清除已有历史。

当前处理：

- 仓库根目录和 `patmail-extension/.gitignore` 忽略 `dist.pem` 与 `*.pem`。已经跟踪的文件不会因为忽略规则自动移出索引。
- `pnpm pack:source` 使用白名单生成 `test-results/patmail-source.zip`。白名单是 `src`、`tests`、`docs`、`scripts` 和列出的工程文件。本次包有 367 个条目，列表中没有 `.pem`。
- 日志、报告和测试不读取、不打印私钥内容。
- 本次没有把私钥提交到 Git。
