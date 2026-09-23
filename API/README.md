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
| [02-公共数据.md](02-公共数据.md) | GetFileType / IPGetBasicData |
| [03-历史查询条件.md](03-历史查询条件.md) | SearchQueryHisList / SearchQueryHisSave / SearchQueryHisDelete |
| [04-文件查询.md](04-文件查询.md) | GetSearchFiles |
| [05-文件查询字段映射.md](05-文件查询字段映射.md) | FileSearch DOM / QueryXml ↔ GetSearchFiles |
| [06-文件操作.md](06-文件操作.md) | GetFileName / 收文 / 删除 / 上传 / 下载（含未完成项） |
| [07-发文与邮件.md](07-发文与邮件.md) | MailCustomer / SaveMailInfo |
| [08-流程审批.md](08-流程审批.md) | Flow.ashx / IhgFlow |

## 接口清单

| 模块 | Handler | Call | 状态 |
|---|---|---|---|
| 案件详情 | CaseInfo.ashx | GetCaseInfo | 已落盘 |
| 销售人员 | CaseInfo.ashx | GetCaseSales | 已落盘 |
| 流程人员 | CaseInfo.ashx | GetFlowUser | 已落盘 |
| 销售助理 | CaseInfo.ashx | GetSalesAssistant | 已落盘 |
| 费用列表 | CaseInfo.ashx | GetFeeListByCase | 已落盘 |
| 文件类型 | Common.ashx | GetFileType | 已落盘 |
| 基础枚举 | 待确认 | IPGetBasicData | 入口已确认 |
| 历史查询列表/加载 | CaseInfo.ashx | SearchQueryHisList | 已落盘 |
| 历史查询保存 | CaseInfo.ashx | SearchQueryHisSave | 已落盘 |
| 历史查询删除 | CaseInfo.ashx | SearchQueryHisDelete | 已落盘 |
| 文件查询 | CaseInfo.ashx | GetSearchFiles | 已落盘 |
| 文件名称 | CaseInfo.ashx | GetFileName | 入口已确认 |
| 文件收文查询 | CaseInfo.ashx | GetFileReceiveInfo | 入口已确认 |
| 批量删文件 | CaseInfo.ashx | BatchDelFile | 入口已确认 |
| 保存收文 | CaseInfo.ashx | SaveFileReceiveInfo | 入口已确认 |
| 客户发文 | 待确认 | MailCustomer | 入口已确认 |
| 保存邮件 | 待确认 | SaveMailInfo | 入口已确认 |
| 上传 / 保存文件 / 新增文件 / 下载 | 待确认 | UploadFile / SaveFile / AddFile / Download | 未逆向 |
| 流程提交 | Flow.ashx | 待确认 | 未逆向 |
