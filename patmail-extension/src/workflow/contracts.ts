import { isQueryGuid } from '../query/query-validator'
import { isRecord, readClientInfo } from '../api/response-guards'
import type { AuditType, WorkflowActivity, WorkflowHistory, WorkflowNode, WorkflowReviewer, WorkflowUrgency } from './types'

/** 发文流程抓包中的 flow_type。只用于邮件 obj_id，不作为其他业务的默认值。 */
export const MAIL_FLOW_TYPE = 'CO'
const PAGE = 'mail.aspx'
const FLOW_PAGE = 'IhgFlow.aspx'

export function flowInfoParams(mailId: string, flowType: string): URLSearchParams | null {
  if (!isQueryGuid(mailId) || !flowType.trim()) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetFlowInfo')
  params.set('obj_id', mailId)
  params.set('flow_type', flowType)
  params.set('flow_sub_type', '')
  params.set('log_pagename', PAGE)
  return params
}

export function flowHistoryParams(mailId: string): URLSearchParams | null {
  if (!isQueryGuid(mailId)) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetFlowHistory')
  params.set('obj_id', mailId)
  params.set('log_pagename', PAGE)
  return params
}

export function urgencyParams(): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'GetUrgencyList')
  params.set('log_pagename', FLOW_PAGE)
  return params
}

export function lastStatusParams(mailId: string, flowType: string): URLSearchParams | null {
  if (!isQueryGuid(mailId) || !flowType.trim()) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetFlowLastStatus')
  params.set('obj_id', mailId)
  params.set('flow_type', flowType)
  return params
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function listParts(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(';').map(item => item.trim()).filter(Boolean)
}

/** user_list_id 与 user_list_name 按分号对齐。人数不一致时不硬配。 */
function pairedReviewers(ids: string[], names: string[]): { reviewers: WorkflowReviewer[]; reviewerFormat: WorkflowNode['reviewerFormat'] } | null {
  if (ids.length === 0 || ids.length !== names.length || ids.some(id => !isQueryGuid(id))) return null
  if (names.some(name => /[;,]/.test(name))) return null
  return {
    reviewers: ids.map((id, index) => ({ id, name: names[index] })),
    reviewerFormat: ids.length === 1 ? 'single' : 'structured'
  }
}

function reviewersOf(row: Record<string, unknown>): { reviewers: WorkflowReviewer[]; reviewerFormat: WorkflowNode['reviewerFormat'] } {
  if (Array.isArray(row.user_list)) {
    const reviewers: WorkflowReviewer[] = []
    for (const item of row.user_list) {
      if (!isRecord(item) || typeof item.user_id !== 'string' || !isQueryGuid(item.user_id)) return { reviewers: [], reviewerFormat: 'unknown' }
      reviewers.push({ id: item.user_id, name: typeof item.cn_name === 'string' ? item.cn_name : '' })
    }
    return { reviewers, reviewerFormat: 'structured' }
  }
  const names = listParts(row.user_list_name)
  const pairedIds = pairedReviewers(listParts(row.user_list_id), names)
  if (pairedIds) return pairedIds
  const pairedList = pairedReviewers(listParts(row.user_list), names)
  if (pairedList) return pairedList
  if (typeof row.user_list_id === 'string' && isQueryGuid(row.user_list_id) && typeof row.user_list_name === 'string' && !/[;,]/.test(row.user_list_name)) {
    return { reviewers: [{ id: row.user_list_id, name: row.user_list_name }], reviewerFormat: 'single' }
  }
  return { reviewers: [], reviewerFormat: 'unknown' }
}

export interface FlowInfoFields {
  objId: string
  flowId: string
  flowType: string
  flowSubType: string | null
  deptId: string | null
  deptFullName: string | null
  status: number | null
  curNodeId: string | null
  curUserId: string | null
  nodeCode: string | null
  nodeName: string | null
  cnName: string | null
  isSkip: boolean | null
  isEnabled: boolean | null
  urgencyId: string | null
  updateTime: string | null
  updateTimeDd: string | null
  updateTimeMm: string | null
  updateTimeSs: string | null
}

function presentString(row: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, key) || typeof row[key] !== 'string') return null
  return row[key]
}

function presentBoolean(row: Record<string, unknown>, key: string): boolean | null {
  if (!Object.prototype.hasOwnProperty.call(row, key) || typeof row[key] !== 'boolean') return null
  return row[key]
}

export function flowFields(row: Record<string, unknown>): FlowInfoFields {
  return {
    objId: presentString(row, 'obj_id') ?? '',
    flowId: presentString(row, 'flow_id') ?? '',
    flowType: presentString(row, 'flow_type') ?? '',
    flowSubType: presentString(row, 'flow_sub_type'),
    deptId: presentString(row, 'dept_id'),
    deptFullName: presentString(row, 'dept_full_name'),
    status: typeof row.status === 'number' ? row.status : null,
    curNodeId: presentString(row, 'cur_node_id'),
    curUserId: presentString(row, 'cur_user_id'),
    nodeCode: presentString(row, 'node_code'),
    nodeName: presentString(row, 'node_name_zh_cn'),
    cnName: presentString(row, 'cn_name'),
    isSkip: presentBoolean(row, 'is_skip'),
    isEnabled: presentBoolean(row, 'is_enabled'),
    urgencyId: presentString(row, 'urgency_id'),
    updateTime: presentString(row, 'update_time'),
    updateTimeDd: presentString(row, 'update_time_dd'),
    updateTimeMm: presentString(row, 'update_time_mm'),
    updateTimeSs: presentString(row, 'update_time_ss')
  }
}

/** 下一节点查询的参数全部来自本次 GetFlowInfo。缺字段就不发，不用历史 GUID 填上。 */
export interface AccountReviewerList {
  reviewers: Array<{ id: string; name: string }>
  message: string
}

export function flowSubmitQuery(info: FlowInfoFields): URLSearchParams | null {
  if (!isQueryGuid(info.objId) || !isQueryGuid(info.flowId) || !info.flowType.trim()) return null
  if ([info.flowSubType, info.deptId, info.deptFullName, info.curNodeId, info.curUserId, info.nodeCode, info.cnName, info.urgencyId, info.updateTime, info.updateTimeDd, info.updateTimeMm, info.updateTimeSs].some(item => item === null)) return null
  if (info.status === null || info.isSkip === null || info.isEnabled === null) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetFlowSubmit')
  params.set('obj_id', info.objId)
  params.set('flow_id', info.flowId)
  params.set('flow_type', info.flowType)
  params.set('flow_sub_type', info.flowSubType ?? '')
  params.set('dept_id', info.deptId ?? '')
  params.set('dept_full_name', info.deptFullName ?? '')
  params.set('status', String(info.status))
  params.set('cur_node_id', info.curNodeId ?? '')
  params.set('cur_user_id', info.curUserId ?? '')
  params.set('node_code', info.nodeCode ?? '')
  params.set('cn_name', info.cnName ?? '')
  params.set('is_skip', String(info.isSkip))
  params.set('is_enabled', String(info.isEnabled))
  params.set('urgency_id', info.urgencyId ?? '')
  params.set('update_time', info.updateTime ?? '')
  params.set('update_time_dd', info.updateTimeDd ?? '')
  params.set('update_time_mm', info.updateTimeMm ?? '')
  params.set('update_time_ss', info.updateTimeSs ?? '')
  params.set('log_pagename', FLOW_PAGE)
  return params
}

export function readFlowInfo(data: unknown, mailId: string): { ok: true; info: FlowInfoFields } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: 'GetFlowInfo 响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取流程时登录已失效。' }
  if (client.data.Status === false) return { ok: false, message: 'GetFlowInfo 被 EASY 拒绝。' }
  if (!isRecord(data.Result)) return { ok: false, message: 'GetFlowInfo 的 Result 不是对象。' }
  if (typeof data.Result.obj_id !== 'string' || data.Result.obj_id.toLowerCase() !== mailId.toLowerCase()) {
    return { ok: false, message: '流程对象不是当前邮件。' }
  }
  return { ok: true, info: flowFields(data.Result) }
}

export function readFlowHistory(data: unknown): { ok: true; history: WorkflowHistory[]; activity: WorkflowActivity | null } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: 'GetFlowHistory 响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取审核历史时登录已失效。' }
  if (!Array.isArray(data.Result)) return { ok: false, message: '审核历史 Result 不是数组。' }
  const history = data.Result.flatMap(item => {
    if (!isRecord(item)) return []
    return [{
      historyId: text(item, 'history_id'), nodeId: text(item, 'node_id'), nodeCode: text(item, 'node_code'),
      nodeName: text(item, 'node_name_zh_cn'), auditUserId: text(item, 'audit_user_id'), auditUserName: text(item, 'audit_cn_name'),
      auditType: text(item, 'audit_type_zh_cn'), auditTime: text(item, 'audit_time'), remark: text(item, 'remark')
    }]
  })
  const activity = isRecord(data.flow_activity) ? {
    nodeId: text(data.flow_activity, 'node_id'), nodeCode: text(data.flow_activity, 'node_code'), nodeName: text(data.flow_activity, 'node_name'),
    status: typeof data.flow_activity.status === 'number' ? data.flow_activity.status : null,
    auditUserId: text(data.flow_activity, 'audit_user_id'), auditUserName: text(data.flow_activity, 'audit_cn_name'),
    allowEdit: typeof data.flow_activity.allow_edit === 'boolean' ? data.flow_activity.allow_edit : null
  } : null
  return { ok: true, history, activity }
}

/** ClientInfo.Result=false 且 Status=true 时仍然读取 UrgencyList。 */
export function readUrgency(data: unknown): { ok: true; items: WorkflowUrgency[] } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: 'GetUrgencyList 响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取缓急时登录已失效。' }
  if (client.data.Status === false) return { ok: false, message: 'GetUrgencyList 被 EASY 拒绝。' }
  if (!Array.isArray(data.UrgencyList)) return { ok: false, message: 'UrgencyList 不是数组。' }
  const items = data.UrgencyList.flatMap(item => {
    if (!isRecord(item) || typeof item.urgency_id !== 'string' || !isQueryGuid(item.urgency_id)) return []
    return [{ id: item.urgency_id, code: text(item, 'urgency_code'), name: text(item, 'urgency_name'), seq: typeof item.seq === 'number' ? item.seq : null }]
  })
  return { ok: true, items }
}

/** 节点字段来自页面脚本。响应正文未保存，调用方必须把结果标成未核对。 */
export function readFlowSubmit(data: unknown): { ok: true; nodes: WorkflowNode[]; contract: 'unverified' } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: 'GetFlowSubmit 响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取下一节点时登录已失效。' }
  if (!Array.isArray(data.Result)) return { ok: false, message: 'GetFlowSubmit 的 Result 不是数组。响应正文尚未核对。' }
  const nodes = data.Result.flatMap(item => {
    if (!isRecord(item) || typeof item.node_id !== 'string' || !isQueryGuid(item.node_id)) return []
    const people = reviewersOf(item)
    const node: WorkflowNode = {
      listId: text(item, 'list_id'), seq: typeof item.seq === 'number' ? item.seq : null, next: text(item, 'next'),
      nodeId: item.node_id, nodeCode: text(item, 'node_code'), nodeName: text(item, 'node_name_zh_cn'),
      allowSkip: typeof item.allow_skip === 'boolean' ? item.allow_skip : null, userType: text(item, 'user_type'),
      parallel: item.is_parallel === 1 ? true : item.is_parallel === 0 ? false : null,
      needAllAudit: item.need_all_audit === 1 ? true : item.need_all_audit === 0 ? false : null,
      reviewers: people.reviewers, reviewerFormat: people.reviewerFormat
    }
    return [node]
  })
  return { ok: true, nodes, contract: 'unverified' }
}

export function readLastStatus(data: unknown): { ok: true; present: boolean; token: string | null } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: 'GetFlowLastStatus 响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '核对流程版本时登录已失效。' }
  if (data.last_status === null || data.last_status === undefined) return { ok: true, present: false, token: null }
  if (!isRecord(data.last_status)) return { ok: false, message: 'last_status 结构未知。' }
  const token = data.last_status.update_time_ss
  if (typeof token !== 'string') return { ok: true, present: true, token: null }
  return { ok: true, present: true, token }
}

export function versionAgrees(status: number | null, currentToken: string | null, lastPresent: boolean, lastToken: string | null): 'match' | 'stale' | 'unknown' {
  if (status === -1 && !lastPresent) return 'match'
  if (currentToken === null || !lastPresent || lastToken === null) return 'unknown'
  return currentToken === lastToken ? 'match' : 'stale'
}

/** 页面脚本里的下一节点状态。END=5000，FIRST=0，其余 1000。 */
export function nextFlowStatus(nodeCode: string): '5000' | '0' | '1000' | null {
  if (nodeCode === 'END') return '5000'
  if (nodeCode === 'FIRST') return '0'
  if (nodeCode.trim()) return '1000'
  return null
}

export function isAuditType(value: string): value is AuditType {
  return value === 'submit' || value === 'handover'
}

export function readFlowSubmitResult(data: unknown): 'accepted' | 'rejected' | 'unknown' {
  if (!isRecord(data)) return 'unknown'
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return 'unknown'
  if (client.data.Result === true) return 'accepted'
  if (client.data.Result === false) return 'rejected'
  return 'unknown'
}
