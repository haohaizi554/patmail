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
| [02-公共数据.md](02-公共数据.md) | IPGetBasicData / GetFlowdirection / LoadFileTypeByCaseType / GetFileType |
| [03-历史查询条件.md](03-历史查询条件.md) | SearchQueryHisList / SearchQueryHisSave / SearchQueryHisDelete |
| [04-文件查询.md](04-文件查询.md) | GetSearchFiles |
| [05-文件查询字段映射.md](05-文件查询字段映射.md) | FileSearch DOM / QueryXml ↔ GetSearchFiles |
| [06-文件操作.md](06-文件操作.md) | GetFileName / 收文 / 删除 / 上传 / 下载（含未完成项） |
| [07-发文与邮件.md](07-发文与邮件.md) | MailCustomer / SaveMailInfo / 邮件页读取 |
| [08-流程审批.md](08-流程审批.md) | GetFlowInfo / GetFlowHistory / GetUrgencyList / GetFlowSubmit / FlowSubmit |
| [09-期限监控.md](09-期限监控.md) | GetLimitMonitorCaseList / LimitMailCustomer |

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
| 历史查询列表/加载 | CaseInfo.ashx | SearchQueryHisList | 已落盘 |
| 历史查询保存 | CaseInfo.ashx | SearchQueryHisSave | 已落盘 |
| 历史查询删除 | CaseInfo.ashx | SearchQueryHisDelete | 已落盘 |
| 文件查询 | CaseInfo.ashx | GetSearchFiles | 已落盘 |
| 文件名称 | CaseInfo.ashx | GetFileName | 请求和只读响应已核对 |
| 文件收文查询 | CaseInfo.ashx | GetFileReceiveInfo | 只读响应已核对 |
| 批量删文件 | CaseInfo.ashx | BatchDelFile | 页面参数已核对，未调用 |
| 保存收文 | CaseInfo.ashx | SaveFileReceiveInfo | 页面参数已核对，未调用 |
| 下载 | BaseInfo.ashx / FileHandler.ashx | DownLoad | 页面步骤已核对，未下载文件 |
| 客户发文 | Notice.ashx | MailCustomer | 请求和成功条件已核对，未重新调用 |
| 期限监控列表 | Report.ashx | GetLimitMonitorCaseList | 请求和只读响应已核对 |
| 期限监控发文 | Notice.ashx | LimitMailCustomer | 请求和页面成功条件已核对，未重新调用 |
| 保存邮件 | Mail.ashx | SaveMailInfo | 请求和成功条件已核对，未重新调用 |
| 邮件页读取 | Mail.ashx | GetMailInfo / GetMailCase / GetMailFile 等 | 只读响应已核对 |
| 上传 | UploadFile.aspx | CommUpload | 页面入口已核对，未上传 |
| 流程信息 | Common.ashx | GetFlowInfo / GetFlowHistory / GetUrgencyList | 只读响应已核对 |
| 流程节点 | Common.ashx | GetFlowSubmit | 请求已核对，响应正文未保存，未调用 |
| 流程提交 | Common.ashx | FlowSubmit | 页面参数已核对，未调用 |
