# Phase 3.1 收口

Phase 3.1 已把完整页面接到现有 Background：EASY 绑定、客户覆盖保留、规则单写入口、任务按 EASY Origin 保存、缺参验收不发请求。真实 EASY 登录当时就是 PENDING，生产写开关保持关闭。

Phase 3.2 在这条链上补了三处没有收口的行为：

- `QueryTemplateSection` 仍直接 `ChromeBundleRepository` / `CustomerQueryService` 写客户和本地模板。
- `useWorkspace` 会把任意异步响应写进当前页面，连接快照会把 `load` 再次打回会话检测。
- `SaveTask` 把消息里的任务对象直接持久化；`acceptanceForm` 给所有接口塞同一组 `mail_id` / `case_type_id` / `flow_type`。

这些都在 3.2 的实现里改掉了。3.1 的正式入口没有换：`chrome-extension://<extension-id>/app.html`。
