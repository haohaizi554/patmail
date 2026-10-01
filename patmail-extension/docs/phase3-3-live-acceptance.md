> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.3 真实 EASY 只读验收

状态：**PENDING**。

本次执行环境没有已授权的 EASY 登录会话。`tests/extension.e2e.mjs` 拦截 `http://183.36.43.66:88`，用本地 Fixture 完成完整页面验收。Fixture 不能代替真实联调。

因此下列项目没有在真实 EASY 上核对：

- 当前用户 GUID
- 客户内部 ID
- 文件描述内部 ID
- 发文类型内部 ID
- 已有邮件只读信息
- 当前流程与审核历史

有已授权会话后，优先核对已经具备完整只读请求契约的接口：`GetUserModel`、`IPGetBasicData`、`GetFlowdirection`、`LoadFileTypeByCaseType`、`LoadMailType`，以及邮件和流程只读接口。需要参数的调用应使用现有测试记录，不补猜测字段。
