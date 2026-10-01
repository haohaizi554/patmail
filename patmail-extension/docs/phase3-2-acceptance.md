> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 验收记录

命令在 `patmail-extension` 目录执行。代理变量已清掉后再跑浏览器测试。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。Lockfile is up to date，Already up to date |
| `pnpm test` | 通过。20 files，147 tests |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过。最终构建在 e2e 之前又执行了一次 |
| `pnpm test:e2e` | 通过。15 browser checks passed |

真实 EASY 登录：PENDING。浏览器测试使用 fixture `http://183.36.43.66:88`，不是现场会话。

`EASY_MAIL_WRITES_ENABLED` 与 `WORKFLOW_WRITES_ENABLED` 仍为 false。完整页面流程没有提交邮件，也没有提交流程。

Full-page E2E 点击了：连接 EASY 标签页、保存并编辑客户、文件查询与跨页选择、绑定客户、后台生成任务、规则变更后任务过期、刷新后恢复、缺参 GetMailInfo 不发请求、502 的 GetMailInfo 为 FAIL、GetFlowInfo 业务失败不为 PASS、GetUserModel 为 PASS 且未与原网页对照、旧规则版本保存被拒绝、切换用户乙后看不到测试客户、service worker 重启后重新检测会话。
