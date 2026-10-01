> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.6 真实只读验收

本轮环境没有已授权的 EASY 登录会话。没有访问真实 EASY 服务器，也没有把 Fixture 记成现场通过。

现场步骤保持 **PENDING**：

1. `GetUserModel`，取得稳定用户 GUID。
2. `GetSearchFiles`，用真实查询条件取得文件。
3. `LoadFileTypeByCaseType`，核对文件描述和内部 ID。
4. `LoadMailType`，核对发文类型。
5. 读取一封已有测试邮件，核对客户、案件和文件关联。
6. 读取流程信息和审核历史。

## 当前归一化能确认的文件字段

产品文件查询解析器已经映射：

- `file_id`
- `file_name`
- `file_desc`
- `case_id`
- `case_volume`
- `app_no`
- `customer_name`

响应里没有这些值时，计划保持未知，不用页面提交值补齐。

## 尚未在查询响应里确认的内部 GUID

- 文件描述内部 ID：`GetSearchFiles` 的当前归一化模型只提供描述文本。唯一字典匹配可以记为 `EASY_DICTIONARY`。不能唯一匹配时不猜测 GUID。
- 客户内部 GUID：查询响应没有可靠的客户 ID 字段。文件上的 `customerId` 保持未验证。本地 Profile 的 `easyCustomerId` 不写入文件，也不能直接用于 `MailCustomer` 或 `SaveMailInfo`。

## 仍为 CONTRACT_PENDING 的验收接口

- `GetSearchFiles`
- `GetMailRule`
- `GetCustomerContact`
- `GetSignature`
- `GetFlowSubmit`

产品查询使用已有的 `buildGetSearchFilesParams`。验收表单没有收集那份完整查询，所以验收契约里的 `GetSearchFiles` 继续保持 `CONTRACT_PENDING`。
