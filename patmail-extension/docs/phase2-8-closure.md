# Phase 2.8 收口

日期：2026-09-26。本文件记录进入 Phase 2.9 之前仍然影响真实联调的问题，以及本阶段的处理。

## 已收口

| 问题 | 处理 |
|---|---|
| 未确认用户写入 `"session"` 任务命名空间 | 只有合法 EASY 用户 GUID 可以保存、读取任务和领取租约。空用户和非 GUID 只保留内存 Dry-run |
| `ruleSnapshot: input.rules` 与界面对象共享引用 | `createTaskSnapshot()` 使用 `structuredClone`。修改当前规则、绑定或 Profile 不会改旧任务 |
| 指纹只记本地 Profile 编号 | `CustomerIdentitySnapshot` 记录 `easyCustomerId`、绑定来源和确认状态。EASY 客户编号变化会使任务 `STALE`。本地 Profile 编号不会被写成 EASY customer_id |
| 租约只有 claim / markSent / recover | 补齐 prepared、sent、response、verified、complete、release-before-send、unknown |
| `requestSent=false` 的运行中租约会永久占住指纹 | Background 重启后，未发送的租约释放。已发送的变成 `UNKNOWN`，不能再次创建 |
| 内容脚本直接打开页面 IndexedDB | 任务、租约和证据由 Background 消息写入扩展自己的存储 |
| 迁移先只读、再另开事务写回 | 需要迁移时，在同一次 readwrite 事务里读取、迁移并写回 |
| 相等排序键返回 1 | 主键相等时返回 0，并继续比较稳定的次级键。收件人地址顺序保留，不把有业务含义的顺序打乱 |

## 仍然成立的边界

`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED`、`crossTabCreateAtomic`、`CROSS_TAB_WRITE_EXCLUSION_PROVEN` 保持 false。`chrome.storage` 上的旧协调器仍然不是事务。本地租约互斥不等于 EASY 服务端恰好执行一次。

真实 EASY 只读没有在本环境执行。`LIVE_EASY_ACCEPTANCE.status` 仍是 `PENDING`。
