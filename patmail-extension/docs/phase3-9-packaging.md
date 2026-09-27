# Phase 3.9 交付包

正式对外包只有两条命令：

- `pnpm pack:source` 生成 `test-results/patmail-source.zip`。本次 388 个条目。
- `pnpm pack:delivery` 生成 `test-results/patmail-delivery.zip`。本次 12 个条目。

`pnpm verify:archive` 列出压缩包成员名。出现 `.pem`、`.key`、`credentials.json`、`.env` 或 `cookies.txt` 时失败。成员路径如果不在上述两个白名单里，也失败。这次两条正式包都通过，各检查了 388 和 12 个成员。检查不读取、不打印私钥内容。

工作区里的 `patmail-extension/dist.pem` 已移到 `D:\desktop\patmail-signing-keys\dist.pem`。这是移动，不是删除，也没有轮换。Git 历史从提交 `15d5b4e` 起仍包含这把密钥。如果仓库或旧的整包压缩包曾经对外发出，应视为已经暴露。轮换会改变扩展 ID 和已安装扩展的本地数据。停止跟踪需要所有者自行 `git rm --cached` 并提交，本阶段没有提交。

`.gitignore` 不能阻止手工把整个工程目录打成 ZIP。对外交付应使用上面两个命令，再用 `pnpm verify:archive` 或 `pnpm verify:archive <压缩包路径>` 检查最终文件。
