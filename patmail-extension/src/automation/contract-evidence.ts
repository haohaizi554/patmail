export type EvidenceSource = 'captured-response' | 'captured-request' | 'page-script' | 'mock' | 'unverified'

export interface ContractEvidence {
  handler: string
  call: string
  method: 'POST'
  contentType: string
  requestFields: string[]
  fieldSources: string
  responseShape: string
  successCondition: string
  responseCaptured: boolean
  source: EvidenceSource
  status: 'verified' | 'pending'
  note: string
}

const FORM = 'application/x-www-form-urlencoded; charset=UTF-8'

export const CONTRACT_EVIDENCE: ContractEvidence[] = [
  {
    handler: '/AjaxServers/Notice.ashx', call: 'MailCustomer', method: 'POST', contentType: FORM,
    requestFields: ['Call', '_file_ids', '_file_names', 'mailstyle', 'mailtype', 'log_pagename'],
    fieldSources: '已核对的发文创建请求。单个来文的 mailstyle 仍未知。',
    responseShape: '页面成功条件是 objid。响应正文没有保存。',
    successCondition: '出现 objid。缺 objid 按未知处理，不能重试。',
    responseCaptured: false, source: 'captured-request', status: 'pending',
    note: '不能为了补响应在正式客户记录上重试。'
  },
  {
    handler: '/AjaxServers/Mail.ashx', call: 'SaveMailInfo', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'mail_id', 'mail_type', 'customer_id', 'mail_to', 'mail_subject', 'mail_body'],
    fieldSources: '保存字段名来自页面脚本和字段对照。customer_id 只用邮件快照里的 GUID。',
    responseShape: '正文未保存。',
    successCondition: 'ClientInfo.Status=true 只表示请求被接受的页面判断，仍要回读。',
    responseCaptured: false, source: 'page-script', status: 'pending',
    note: 'Status=false 是失败。超时进入 UNKNOWN。'
  },
  {
    handler: '/AjaxServers/Mail.ashx', call: 'SaveMailRalteCaseFile', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'mail_id', 'file_ids'],
    fieldSources: 'mail.js 用勾选文件的 objid 以分号拼接。HAR 里这次值为空。',
    responseShape: '正文未保存。',
    successCondition: 'Status=true 不是关联成功。必须回读 GetMailFile。',
    responseCaptured: false, source: 'captured-request', status: 'pending',
    note: '格式未核对时保持 BINDING_BLOCKED，不调用。'
  },
  {
    handler: '/AjaxServers/Common.ashx', call: 'GetFlowInfo', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'obj_id', 'flow_type', 'flow_sub_type', 'log_pagename'],
    fieldSources: '发文抓包。flow_type=CO 只属于这次发文流程。',
    responseShape: 'Result 是对象，含 flow_id、cur_node_id、update_time_ss 等已核对字段。',
    successCondition: 'ClientInfo 登录有效且 Result.obj_id 等于当前邮件。',
    responseCaptured: true, source: 'captured-response', status: 'verified',
    note: '只读。'
  },
  {
    handler: '/AjaxServers/Common.ashx', call: 'GetFlowHistory', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'obj_id', 'log_pagename'],
    fieldSources: '已核对请求。',
    responseShape: 'Result 是历史数组，flow_activity 是当前活动节点。',
    successCondition: '登录有效且 Result 为数组。',
    responseCaptured: true, source: 'captured-response', status: 'verified',
    note: '历史和当前活动不是同一种结构。'
  },
  {
    handler: '/AjaxServers/Common.ashx', call: 'GetUrgencyList', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'log_pagename'],
    fieldSources: '已核对请求。',
    responseShape: 'UrgencyList：urgency_id、urgency_code、urgency_name、seq。',
    successCondition: 'Status=true 时读取列表。Result=false 仍可能有列表。',
    responseCaptured: true, source: 'captured-response', status: 'verified',
    note: '只读。'
  },
  {
    handler: '/AjaxServers/Common.ashx', call: 'GetFlowSubmit', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'obj_id', 'flow_id', 'flow_type', 'status', 'cur_node_id', 'update_time_ss'],
    fieldSources: '请求字段来自当时的 GetFlowInfo。',
    responseShape: 'HAR 响应长度为 0。节点字段只来自 IhgFlow.js。',
    successCondition: '502 不是成功。没有真实 Result 数组样本。',
    responseCaptured: false, source: 'page-script', status: 'pending',
    note: 'Mock 节点不能代替真实候选人。'
  },
  {
    handler: '/AjaxServers/Common.ashx', call: 'GetFlowLastStatus', method: 'POST', contentType: FORM,
    requestFields: ['Call', 'obj_id', 'flow_type'],
    fieldSources: '提交前比较。',
    responseShape: '比较 last_status.update_time_ss。status=-1 允许 last_status 为空。',
    successCondition: '版本一致才继续。不一致则旧计划作废。',
    responseCaptured: true, source: 'captured-response', status: 'verified',
    note: '只读。完整响应样本仍不包含全部嵌套字段。'
  },
  {
    handler: '/AjaxServers/Common.ashx', call: 'FlowSubmit', method: 'POST', contentType: FORM,
    requestFields: ['f_obj_id', 'f_flow_id', 'f_next_node_id', 'f_next_user_id', 'f_audit_type_id', 'f_status'],
    fieldSources: '参数名和 f_status 计算来自页面脚本。响应正文没有保存。',
    responseShape: '未捕获。',
    successCondition: '脚本里是 ClientInfo.Result=true，且必须回读流程。',
    responseCaptured: false, source: 'page-script', status: 'pending',
    note: '不在传输白名单。生产路径不调用。'
  },
  {
    handler: '/AjaxServers/Mail.ashx', call: 'EndEmailFlowd', method: 'POST', contentType: FORM,
    requestFields: ['f_obj_id', 'f_cur_status', 'f_status', 'f_allow_edit', 'f_flow_id', 'f_flow_type', 'f_flow_sub_type', 'f_cur_node_id', 'f_cur_node_code', 'f_next_node_id', 'f_next_node_code', 'f_audit_type_id'],
    fieldSources: 'mail.js 的 Mail.EndFlow。f_status 固定 5000，下一节点固定 END。',
    responseShape: '回调不读字段。',
    successCondition: '不能把它当成审核通过或邮件发送。',
    responseCaptured: false, source: 'unverified', status: 'pending',
    note: '不发明参数，不调用。'
  }
]

export function evidenceFor(call: string): ContractEvidence | null {
  return CONTRACT_EVIDENCE.find(item => item.call === call) ?? null
}
