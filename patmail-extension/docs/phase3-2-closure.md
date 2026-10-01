> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.2 收口

Phase 3.2 已经把完整页面的客户、模板和规则写入收进 Background，并用 `createTaskPlan` 生成任务。随后的源码审计确认这些还没有封口：

- `MessageType.SaveTask` 仍接受整份 `AutomationTask`。`TaskStore.save` 按 `taskId` 替换，不查看已有执行证据。
- `queryTemplateVersionOf` 只用客户 `id` 和 `updatedAt` 做字符码求和，模板字段变化不会进入过期判断。
- `accountPayload` 先记下连接，再异步读取客户和任务。读取完成前换账号时，可能把旧账号数据和新连接一起返回。
- `mutationGuard` 通过后，保存分支再次读取当时的 `host.connection.context`。
- `useWorkspace` 用一个全局请求序号。后面的只读刷新会丢掉已经成功的保存回执。`chrome.storage.onChanged` 在 `inflight > 0` 时直接返回。
- 页面展示本地预览 `taskId`，后台持久化的是另一个编号。
- 页面传入的文件选择被当成已经在 EASY 验证过。
- 手工 `expectedFields` 匹配后被记成 `UI_COMPARED`。

这些缺口由 Phase 3.3 修改。Phase 3.2 的测试在本次 `pnpm test` 中继续通过。生产邮件写入和生产工作流写入保持关闭。
