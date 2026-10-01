> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.4 业务规则

## 发文方式

每个 `CustomerQueryProfile` 对应一条 `CustomerMailPolicy`。只实现两种：

| sendMode | 行为 |
|---|---|
| `merge_by_customer_description` | 同一客户身份且同一文件描述合成一封草稿 |
| `single_file` | 每个文件一封草稿 |

不实现同第一联系人、同申请人、年费代理机构等其他模式。

## 客户身份

文件查询结果只有 `customer_name`，没有可靠的客户内部 ID。分组不使用客户名称，也不按名称相似度合并。

用户必须把已选文件明确绑定到已有 `CustomerQueryProfile`。绑定后身份是 `profile:{customerProfileId}`。如果将来某行真有 `customerId`，身份可以是 `easy:{customerId}`，但仍要有启用的客户发文配置。没有身份的文件单独标成不可规划，不并入其他客户。

## 文件描述

有 `fileDescriptionId` 时，分组键是 `id:{id}`，映射也只按这个 ID 精确匹配。没有 ID 时，分组键和映射都使用去掉首尾空白后的描述原文，精确相等。不使用模糊或相似度匹配。空描述不分组。

映射保存发文类型的 EASY GUID 和显示名称。中文名称不能当作 `mailTypeId`。禁用的映射不参与匹配。没有映射时草稿为 `blocked`，提示「缺少发文类型映射」。

## 收件人、抄送和签名

收件人模板按 `customerProfileId` 隔离，可有多个，并用 `isDefault` 或策略上的 `recipientTemplateId` 选择。地址去首尾空白、转小写、去重。格式不合法的地址记入问题。收件人为空时草稿 `blocked`。不从客户名称猜测邮箱。

签名按当前操作员 ID 保存。预览只取 `operatorId` 等于当前用户、且启用并默认的签名。没有可靠用户 ID 时，不套用另一个用户的签名。

## 标题

变量只来自当前文件：`{文件名称}`、`{客户名称}`、`{我方文号}`、`{申请号}`、`{文件数量}`。缺失变量保留原占位符并给出警告，不输出 `undefined`。

数量注入由 `countInjection` 决定，锚点默认是「关于」。多个文件且标题含锚点时，在锚点后插入 `N个`。同一标题再次处理时，锚点后已经是「数字 + 个」就不再插入。没有锚点时按配置：保留原标题、加前缀，或标成需要人工确认。不猜测插入位置。

## 正文

顺序是基础模板、用户补充文本、操作员签名。签名文本已经出现时不重复追加。模板只做文本替换，不执行脚本，预览不用 HTML 渲染。

## 明确不做

不调用 `MailCustomer`、`LimitMailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile`、`SubmitWorkflow`、`ApproveWorkflow`。不发送邮件，不在 EASY 创建草稿，不审批，不删除或修改业务数据。预览界面没有发送按钮。
