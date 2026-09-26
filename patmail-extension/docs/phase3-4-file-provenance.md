# Phase 3.4 文件来源

## 查询快照

Background 在转发的 `SEARCH_FILES_RESULT` 成功时，把当前连接的 `easyOrigin`、`operatorId`、`easyTabId`、`connectionVersion`，以及 `queryFingerprint`、`queryTime`、文件 ID 和文件名、描述、客户名、案卷号写入会话级缓存。来源标记为 `EASY_API_RESPONSE`。

这份快照只证明文件出现在当前受控查询响应里。它不证明文件已经按 ID 独立回读。

## 创建任务时的核对

`createTaskPlan` 不直接采用页面自己的来源等级。每个所选 `fileId` 必须出现在同一连接版本的快照中，来源才升为 `SEARCH_RESPONSE_OBSERVED`。客户、描述和案卷号随快照保存，供后续诊断。

文件 ID 不在快照中，或连接身份不一致时，保持 `FILE_SOURCE_UNVERIFIED`。

没有确认过的按 ID 回读接口，因此不新增 EASY 接口，也不写出 `FILE_READBACK_VERIFIED`。缺少这一级证据时，真实写入门禁继续关闭。
