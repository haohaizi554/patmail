# Phase 3.0 验收边界

| 能力 | 状态 |
|---|---|
| 完整页面 UI 已迁移 | 已完成 |
| 真实业务模块已接到后台仓库 | 已完成 |
| 单元测试与 fixture 浏览器测试 | 已通过 |
| 真实 EASY 已登录会话 | 未验证 |
| 真实写操作 | 未执行 |

界面提交的验收记录如果声明 `PASS`，后台保存为 `BLOCKED`，原因是「界面提交不能成为验收通过证明」。界面提交的证据会经 `sealEvidence` 重算等级，`businessSuccess` 和 `readbackMatched` 被置为 false，不能保持 `READBACK_VERIFIED`。

可信只读证据只在后台拿到绑定标签页的 probe 之后生成，并带上当时的 `easyOrigin`、`operatorId` 和实际 Call。HAR 导入仍沿用 Phase 2.9 的降级规则。

受控执行区分：

- Dry-run：本地计划
- Live Readonly：只读验收
- Test Write：白名单为空，不发写请求
- Production Write：关闭

页面上没有「已经执行成功」按钮。fixture 里的文件查询结果标记为测试拦截，不代表真实 EASY 发文成功。
