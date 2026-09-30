# 专利案件管理系统接口文档

服务地址：`http://183.36.43.66:88`  
技术栈：ASP.NET WebForms，Ajax `.ashx` Handler  
统一入口：`POST /AjaxServers/*.ashx`  
Content-Type：`application/x-www-form-urlencoded; charset=UTF-8`

业务动作由参数 `Call` 分发。

## 文档目录

| 文档 | 内容 |
|---|---|
| [00-通用约定.md](00-通用约定.md) | 鉴权、公共请求头、公共响应、调用规则 |
| [01-案件信息.md](01-案件信息.md) | GetCaseInfo / GetCaseSales / GetFlowUser / GetSalesAssistant / GetFeeListByCase |
| [02-公共数据.md](02-公共数据.md) | IPGetBasicData / GetFlowdirection / 部门与人员树 / 所属分部 / 专利标签 |
| [03-历史查询条件.md](03-历史查询条件.md) | SearchQueryHisList / SearchQueryHisSave / SearchQueryHisDelete |
| [04-文件查询.md](04-文件查询.md) | GetSearchFiles |
| [05-文件查询字段映射.md](05-文件查询字段映射.md) | FileSearch DOM / QueryXml ↔ GetSearchFiles |
| [06-文件操作.md](06-文件操作.md) | GetFileName / 下载名称模板 / 收文 / 删除 / 上传 / 下载 |
| [07-发文与邮件.md](07-发文与邮件.md) | MailCustomer / SaveMailInfo / 邮件页读取 |
| [08-流程审批.md](08-流程审批.md) | GetFlowInfo / GetFlowHistory / GetUrgencyList / GetFlowSubmit / FlowSubmit |
| [09-期限监控.md](09-期限监控.md) | LimitMonitorInit / GetLimitMonitorCaseList / LimitMailCustomer |
| [10-邮件签名.md](10-邮件签名.md) | GetMailSignatureSettingList / GetSignatureset / GetSignature / Getmailset |
| [11-客户要求.md](11-客户要求.md) | 客户资料页 GetCustomerlist / GetCustomerDemand，不发文 |
| [12-案件流程图.md](12-案件流程图.md) | 用 GetCaseBusFlow 读子流程停在哪个节点。样本不是状态枚举 |
| [13-案件查询.md](13-案件查询.md) | ICSearchList。按案件查，结束的事项仍能对上案子 |

## 接口清单

| 模块 | Handler | Call | 状态 |
|---|---|---|---|
| 案件详情 | CaseInfo.ashx | GetCaseInfo | 只读响应已核对 |
| 销售人员 | CaseInfo.ashx | GetCaseSales | 只读响应已核对 |
| 流程人员 | CaseInfo.ashx | GetFlowUser | 只读响应已核对 |
| 销售助理 | CaseInfo.ashx | GetSalesAssistant | 现有参数返回系统繁忙，响应未确认 |
| 费用列表 | CaseInfo.ashx | GetFeeListByCase | 只读响应已核对 |
| 文件类型树 | Common.ashx | LoadFileTypeByCaseType | 只读响应已核对 |
| 文件类型 | Common.ashx | GetFileType | 只读响应已核对 |
| 基础枚举 | CaseInfo.ashx | IPGetBasicData | 只读响应已核对 |
| 流向与下载列名 | CaseInfo.ashx | GetFlowdirection | 只读响应已核对 |
| 部门树 | Common.ashx | LoadDeptTree | 只读响应已核对 |
| 人员树 | Common.ashx | GetTreeUser | 只读响应已核对 |
| 代理机构树 | Common.ashx | GetTreeAgent | 响应键 `TreeUser` 已由页面脚本核对，原文未保存 |
| 所属分部 | BaseInfo.ashx | GetDeptBranch | 只读响应已核对 |
| 专利标签 | CaseInfo.ashx | GetApplyTags | 只读响应已核对，当前账号为空 |
| 下载名称模板 | BaseInfo.ashx | GetFileTempNameList | 只读响应已核对 |
| 期限监控初始化 | Report.ashx | LimitMonitorInit | 只读响应已核对 |
| 期限处理事项 | Report.ashx | LimitMonitorGetCtrlproc | 只读响应已核对 |
| 历史查询列表/加载 | CaseInfo.ashx | SearchQueryHisList | 已落盘 |
| 历史查询保存 | CaseInfo.ashx | SearchQueryHisSave | 已落盘 |
| 历史查询删除 | CaseInfo.ashx | SearchQueryHisDelete | 已落盘 |
| 文件查询 | CaseInfo.ashx | GetSearchFiles | 已落盘 |
| 文件名称 | CaseInfo.ashx | GetFileName | 请求和只读响应已核对 |
| 文件收文查询 | CaseInfo.ashx | GetFileReceiveInfo | 只读响应已核对 |
| 批量删文件 | CaseInfo.ashx | BatchDelFile | 页面参数已核对，未调用 |
| 保存收文 | CaseInfo.ashx | SaveFileReceiveInfo | 页面参数已核对，未调用 |
| 下载 | BaseInfo.ashx / FileHandler.ashx | DownLoad | 页面步骤已核对，未下载文件 |
| 客户发文 | Notice.ashx | MailCustomer | 成功只看 `objid`，原文未保存，未重新调用 |
| 期限监控列表 | Report.ashx | GetLimitMonitorCaseList | 请求和只读响应已核对 |
| 期限监控发文 | Notice.ashx | LimitMailCustomer | 成功看 `Status=true` 且 `objid`。`Result=false` 仍可成功。`NeedConfirmFillAgency` 要停 |
| 保存邮件 | Mail.ashx | SaveMailInfo | 成功只看 `ClientInfo.Status`。这次 `Result=false` |
| 关联文件 | Mail.ashx | SaveMailRalteCaseFile | 空 `file_ids` 时 `Status=true`、`Result=false`，页面仍继续 |
| 邮件页读取 | Mail.ashx | GetMailInfo / GetMailCase / GetMailFile 等 | 只读响应已核对 |
| 上传 | UploadFile.aspx | CommUpload | 页面入口已核对，未上传 |
| 流程信息 | Common.ashx | GetFlowInfo / GetFlowHistory / GetUrgencyList | 只读响应已核对。这是发文邮件审批，不是案件页流程图 |
| 案件流程状态 | CaseInfo.ashx | GetCaseBusFlow | 只读响应已核对。当前节点是 `order_by=2`，结束看 `node_code` 是否为 `END` |
| 案件查询 | CaseInfo.ashx | ICSearchList | 只读响应已核对。`is_proc=false` 按案件出数，结束的事项仍在 |
| 查询页点行 | BaseInfo.ashx | GetCaseInfo | 只读响应已核对。只返回三个字段，不是案件详情 |
| 流程节点办理结果 | CaseInfo.ashx | GetFlowNodeInfo | 只读响应已核对。只描述已办节点的这一步，不代表整条流程 |
| 处理事项表 | CaseInfo.ashx | GetProcList | 只读响应已核对。没有子流程节点 |
| 流程节点 | Common.ashx | GetFlowSubmit | 响应已核对。起始、审核、结束三个节点。`Result=false` 仍有节点数组 |
| 发文提交审核 | Mail.ashx | MailSubmit | 成功看 `ClientInfo.Result=true`。`finishdate=false`，评分和期限为空 |
| 通用流程提交 | Common.ashx | FlowSubmit | 页面脚本有这组参数。这次发文没有调用 |
| 结束发文流程 | Mail.ashx | EndEmailFlowd | 参数已由 `mail.js` 核对，这次没有调用 |
| 个人签名名单 | Login.ashx | GetMailSignatureSettingList | 请求和长度已核对，响应正文未保存 |
| 个人签名正文 | Login.ashx | GetSignatureset | 请求和长度已核对，响应正文未保存 |
| 签名页代理机构 | CaseInfo.ashx | GetAencyList | 请求和长度已核对，响应正文未保存 |
| 发文页签名下拉 | Mail.ashx | GetSignature | 请求和字段名已核对，响应正文未保存 |
| 邮箱预留签名 | Login.ashx | Getmailset | 页面参数已核对，这次抓包没有这条请求 |
| 客户列表 | Customer.ashx | GetCustomerlist | 请求已核对，响应正文未保存 |
| 能否打开客户 | Customer.ashx | AllowShowCustomer | 请求和长度已核对，调用点不在 customer.js，响应正文未保存 |
| 客户资料 | Customer.ashx | GetCustomerInfo | 请求已核对，页面读取字段已对照脚本，响应正文未保存 |
| 客户联系人表 | Customer.ashx | GetCustomerContact | 请求已核对。与邮件页 Mail.ashx 的同名 Call 不是一个接口 |
| 客户要求 | Customer.ashx | GetCustomerDemand | 请求和列已核对，响应正文未保存 |
| 客户要求详情 | Customer.ashx | GetDemandInfo | 页面字段已核对，这次抓包没有这条请求 |
