> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.8 交付安全

`dist.pem` 仍在工作区，并已存在于提交 `15d5b4e` 的 Git 历史。本阶段没有删除这把密钥，也没有轮换。轮换会改变扩展 ID 和已安装扩展的本地数据。所有者应先私有备份，再自行决定是否停止跟踪。如果仓库或旧压缩包曾经对外分发，这把密钥应视为已经暴露。

普通交付不再依赖 `.gitignore`。

- `pnpm pack:source` 使用源码白名单，生成 `test-results/patmail-source.zip`。本次 379 个条目，成员名检查没有 `.pem`、密钥、凭据或 Cookie 文件。
- `pnpm pack:delivery` 只打包 `dist/` 里的构建产物，生成 `test-results/patmail-delivery.zip`。本次 12 个条目，同样没有上述文件名。构建目录里若出现私钥文件名，打包会失败。
- `tests/packaging-security.test.ts` 检查文件名分类、一个含 `dist.pem` 占位名的压缩包，以及实际生成的源码包。测试不读取、不打印真实私钥内容。
- 签名应在受控环境中通过显式路径读取密钥，不要把密钥放进对外压缩包。`dist.crx` 不进入这两份白名单包。

手工把整个工程目录打成 ZIP 仍可能带上工作区里的 `dist.pem`。对外交付应使用上面两个命令，并在发出前看成员列表。
