> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.5 真实只读验收

本轮环境没有已授权的 EASY 登录会话。没有访问真实 EASY 服务器，也没有把 Fixture 记成现场通过。

现场步骤保持 **PENDING**：

1. 选择已登录的 EASY 标签页。
2. 检测当前用户。
3. 选择一个真实查询模板。
4. 查询第一页。
5. 翻到第二页继续查询。
6. 选择跨页文件。
7. 核对文件实际客户。
8. 核对文件描述。
9. 生成本地计划。
10. 查看逐文件来源证明。
11. 查看总任务校验状态。

若以后有授权会话，只读链按已确认参数执行：

`GetUserModel` → `GetSearchFiles` → `IPGetBasicData` → `LoadFileTypeByCaseType` → `LoadMailType`

然后再核对已确认的：

`GetMailInfo`、`GetMailFile`、`GetMailCase`、`GetFlowInfo`、`GetFlowHistory`

无法确认参数的接口继续 `CONTRACT_PENDING`，不为了页面上需要一个结果而发送猜测参数。

## 仍为 CONTRACT_PENDING 的验收接口

- `GetSearchFiles`
- `GetMailRule`
- `GetCustomerContact`
- `GetSignature`
- `GetFlowSubmit`

产品文件查询使用已有的 `buildGetSearchFilesParams`。验收表单没有收集那份完整查询，所以验收契约里的 `GetSearchFiles` 继续保持 `CONTRACT_PENDING`。

## 本轮 Fixture 覆盖的范围

`pnpm test:e2e` 使用本地 Fixture，不是现场 EASY。它覆盖了完整页面上的第 1 页和第 2 页选择、客户绑定、Background 重建、任务持久化和刷新恢复。消息桥另用同一查询条件的第 3 页和第 4 页，避免 Fixture 按页码生成的文件 ID 和前一次不同文号的结果撞车。
