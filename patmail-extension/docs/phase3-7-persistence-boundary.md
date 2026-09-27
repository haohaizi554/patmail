# Phase 3.7 持久化边界

观察级别和持久化级别分开记录。

| 观察级别 | 含义 |
| --- | --- |
| `UNVERIFIED` | 没有仍有效的查询响应可以确认这个文件 |
| `SEARCH_RESPONSE_OBSERVED` | 当前进程确实看到了一致的查询响应 |
| `FILE_READBACK_VERIFIED` | 类型仍保留。本阶段任务构建不会发出它 |

| 持久化级别 | 含义 |
| --- | --- |
| `PERSISTED` | 可以按真实存储记录恢复 |
| `MEMORY_ONLY` | 只允许当前进程只读预览，不是可恢复的执行证据 |
| `FAILED` | 查询记录没有保存成功。真正执行前必须重新核验 |

`MEMORY_ONLY` 和 `FAILED` 不把观察级别改回 `UNVERIFIED`。任务的 `identityGate.evidenceRestorable` 只有在全部所选文件都是已观察且 `PERSISTED` 时为 true。来源记录丢失后，不能再声称证据可以恢复和再次核验。

## 观察结果

`rememberObservedSearch` 返回：

- 成功：`querySessionId`、观察级别 `SEARCH_RESPONSE_OBSERVED`、持久化结果、会话状态。
- 失败：`code` 和 `message`。

查询文件列表仍然来自 EASY 响应。来源状态单独显示：

- 已保存查询来源。
- 仅内存保存。
- 查询来源保存失败。
- 查询运行冲突。

无效 continuation 返回 `QUERY_SESSION_INVALID`，消息是“这次翻页的查询运行已失效，请重新查询。”结果不附带旧的 `querySessionId`，页面也会清掉继续翻页所用的来源 ID。来源保存失败不会被显示成网络查询失败。
