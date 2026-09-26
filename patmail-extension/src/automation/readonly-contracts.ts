import { isRecord } from '../api/response-guards'
import { listParams } from '../mail/easy/contracts'
import { isQueryGuid } from '../query/query-validator'
import { flowFields, flowHistoryParams, flowInfoParams, lastStatusParams, urgencyParams } from '../workflow/contracts'

const FILE_PAGE = 'FileSearch.aspx'
const MAIL_PAGE = 'mail.aspx'

export type ContractDecision =
  | { state: 'ready'; params: URLSearchParams; requestShape: string }
  | { state: 'blocked'; reason: string }
  | { state: 'pending'; reason: string }

function ready(params: URLSearchParams): ContractDecision {
  return { state: 'ready', params, requestShape: [...params.keys()].sort().join(',') }
}

function pending(call: string): ContractDecision {
  return { state: 'pending', reason: `${call} CONTRACT_PENDING：请求字段尚未齐备，不发送猜测参数。` }
}

/** 每个接口使用已经核对过的参数名。缺字段或不确认的接口不发请求。 */
export function readonlyContract(call: string, context: { caseTypeId?: string; mailId?: string; flowType?: string }): ContractDecision {
  if (call === 'GetUserModel') {
    const params = new URLSearchParams()
    params.set('Call', 'GetUserModel')
    params.set('log_pagename', '')
    return ready(params)
  }
  if (call === 'IPGetBasicData' || call === 'GetFlowdirection') {
    const params = new URLSearchParams()
    params.set('Call', call)
    params.set('log_pagename', FILE_PAGE)
    return ready(params)
  }
  if (call === 'LoadMailType') {
    const params = new URLSearchParams()
    params.set('Call', 'LoadMailType')
    params.set('log_pagename', 'FileSearchMail.aspx')
    return ready(params)
  }
  if (call === 'GetUrgencyList') return ready(urgencyParams())
  if (call === 'LoadFileTypeByCaseType') {
    if (!isQueryGuid(context.caseTypeId ?? '')) return { state: 'blocked', reason: 'LoadFileTypeByCaseType 需要真实案件类型 ID。' }
    const params = new URLSearchParams()
    params.set('Call', 'LoadFileTypeByCaseType')
    params.set('official', '1')
    params.set('case_type', context.caseTypeId ?? '')
    params.set('file_type', '')
    params.set('log_pagename', FILE_PAGE)
    return ready(params)
  }
  if (call === 'GetMailInfo') {
    if (!isQueryGuid(context.mailId ?? '')) return { state: 'blocked', reason: 'GetMailInfo 需要已有测试邮件 ID。' }
    const params = new URLSearchParams()
    params.set('Call', 'GetMailInfo')
    params.set('mail_id', context.mailId ?? '')
    params.set('log_pagename', MAIL_PAGE)
    return ready(params)
  }
  if (call === 'GetMailFile' || call === 'GetMailCase') {
    if (!isQueryGuid(context.mailId ?? '')) return { state: 'blocked', reason: `${call} 需要已有测试邮件 ID。` }
    return ready(listParams(call, context.mailId ?? '', 1))
  }
  if (call === 'GetFlowInfo') {
    if (!isQueryGuid(context.mailId ?? '')) return { state: 'blocked', reason: 'GetFlowInfo 需要已有邮件 ID。' }
    if (!context.flowType?.trim()) return { state: 'blocked', reason: 'GetFlowInfo 需要流程类型。' }
    const params = flowInfoParams(context.mailId ?? '', context.flowType)
    return params ? ready(params) : { state: 'blocked', reason: 'GetFlowInfo 需要已有邮件 ID。' }
  }
  if (call === 'GetFlowHistory') {
    if (!isQueryGuid(context.mailId ?? '')) return { state: 'blocked', reason: 'GetFlowHistory 需要已有邮件 ID。' }
    const params = flowHistoryParams(context.mailId ?? '')
    return params ? ready(params) : { state: 'blocked', reason: 'GetFlowHistory 需要已有邮件 ID。' }
  }
  if (call === 'GetFlowLastStatus') {
    if (!isQueryGuid(context.mailId ?? '')) return { state: 'blocked', reason: 'GetFlowLastStatus 需要已有邮件 ID。' }
    if (!context.flowType?.trim()) return { state: 'blocked', reason: 'GetFlowLastStatus 需要流程类型。' }
    const params = lastStatusParams(context.mailId ?? '', context.flowType)
    return params ? ready(params) : { state: 'blocked', reason: 'GetFlowLastStatus 需要流程类型。' }
  }
  if (call === 'GetSearchFiles' || call === 'GetMailRule' || call === 'GetCustomerContact' || call === 'GetSignature' || call === 'GetFlowSubmit') {
    return pending(call)
  }
  return { state: 'blocked', reason: `${call} 不在只读验收名单中。` }
}

export function extractReadonlyEvidence(call: string, data: unknown): Record<string, string> {
  const fields: Record<string, string> = {}
  if (typeof data === 'string') {
    if (/<!doctype html|<html|出错了|login/i.test(data)) fields.loginPage = 'true'
    return fields
  }
  if (!isRecord(data)) return fields
  if (isRecord(data.ClientInfo)) {
    if (typeof data.ClientInfo.Status === 'boolean') fields.clientStatus = String(data.ClientInfo.Status)
    if (typeof data.ClientInfo.IsLogin === 'boolean') fields.clientLogin = String(data.ClientInfo.IsLogin)
  }
  if (call === 'GetUserModel' && isRecord(data.UserModel)) {
    if (typeof data.UserModel.user_id === 'string') fields.userId = data.UserModel.user_id
    if (typeof data.UserModel.Name === 'string') fields.displayName = data.UserModel.Name.slice(0, 80)
  }
  if (call === 'GetMailInfo') {
    const row = isRecord(data.mailInfo) ? data.mailInfo : data
    if (typeof row.mail_id === 'string') fields.mailId = row.mail_id
    if (typeof row.customer_id === 'string') fields.customerId = row.customer_id
    if (typeof row.mail_type === 'string') fields.mailType = row.mail_type.slice(0, 80)
    if (Array.isArray(data.files)) fields.fileCount = String(data.files.length)
  }
  if (call === 'GetFlowInfo' && isRecord(data.Result)) {
    const info = flowFields(data.Result)
    if (info.flowId) fields.flow_id = info.flowId
    if (info.curNodeId) fields.cur_node_id = info.curNodeId
    if (info.nodeCode) fields.node_code = info.nodeCode
    if (info.status !== null) fields.status = String(info.status)
    if (info.curUserId) fields.current_user_id = info.curUserId
    if (info.updateTimeSs) fields.update_time_ss = info.updateTimeSs
  }
  if (call === 'LoadFileTypeByCaseType' && Array.isArray(data.FileType)) fields.nodeCount = String(data.FileType.length)
  if (call === 'GetSearchFiles') {
    if (typeof data.TableRowsCount === 'string' || typeof data.TableRowsCount === 'number') fields.total = String(data.TableRowsCount)
    const rows = Array.isArray(data.TableRows) ? data.TableRows : []
    const first = rows.find(isRecord)
    if (first && typeof first.file_id === 'string') fields.fileId = first.file_id
  }
  return fields
}
