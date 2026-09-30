import { buildLimitMailCustomerParams } from '../api/limit-monitor-params'
import { isRecord, readClientInfo } from '../api/response-guards'
import type { EasyTransport } from '../api/transport'
import { readMailInfo, readSaveMailInfo, SAVE_KEYS, saveParams } from '../mail/easy/contracts'
import { loadMailContactText } from '../mail/easy/mail-contacts'
import { planPctRecipients, sheetDisplayName } from './pct-recipients'
import type { PctTaskRow } from './types'
import { isQueryGuid } from '../query/query-validator'
import { isWriteSwitchOpen } from '../settings/write-switch'
import { MessageType, type MessageBridge } from '../shared/message'
import {
  flowInfoParams, flowSubmitQuery, lastStatusParams, readFlowInfo, readFlowSubmit, readLastStatus, readUrgency,
  urgencyParams, versionAgrees, type FlowInfoFields
} from '../workflow/contracts'
import { resolveReviewer } from '../workflow/reviewer-resolver'
import type { WorkflowNode, WorkflowReviewer, WorkflowUrgency } from '../workflow/types'

const FLOW_PAGE = 'IhgFlow.aspx'
const LEDGER_KEY = 'patmail.limitMailSubmit.v1'
const BATCH_LIMIT = 20

export interface LimitMailSubmitItem {
  procId: string
  mailTypeId: string
  mailStyle: '1'
  /** 上一封已经创建、提交还没发出时沿用，不再调用 LimitMailCustomer。 */
  mailId?: string
  /** ipr：收件人是表格 IPR，抄送是发文页商务。lead：收件人是技术负责人，抄送是 IPR 和商务。 */
  mode: 'ipr' | 'lead'
  customerName: string
  contactName: string
  iprName: string
  leadName: string
}

export interface LimitMailSubmitResult {
  procId: string
  mailId: string
  state: 'submitted' | 'created' | 'unknown' | 'failed'
  message: string
}

export interface LimitMailMark {
  procId: string
  mailId: string
  state: 'created' | 'submitted' | 'unknown'
}

/** 起始节点的 next 指向的下一节点。结束节点不在这次提交里。 */
export function pickMailSubmitNodes(nodes: WorkflowNode[]): { ok: true; current: WorkflowNode; next: WorkflowNode } | { ok: false; message: string } {
  const current = nodes.find(node => node.nodeCode === 'FIRST')
  if (!current) return { ok: false, message: '流程里没有起始节点，没有提交。' }
  const next = nodes.find(node => node.seq !== null && String(node.seq) === current.next.trim())
  if (!next) return { ok: false, message: '起始节点没有指向下一节点，没有提交。' }
  if (next.nodeCode === 'END') return { ok: false, message: '下一节点是结束。这次只提交给审核人，没有结束流程。' }
  if (next.parallel !== false) return { ok: false, message: '下一节点是并行审核，提交格式还没有这次抓包，没有提交。' }
  if (next.needAllAudit !== false) return { ok: false, message: '下一节点需要全部审核，没有提交。' }
  if (typeof next.allowEdit !== 'boolean') return { ok: false, message: '下一节点没有 allow_edit，没有提交。' }
  if (!isQueryGuid(next.listId) || !isQueryGuid(next.nodeId) || !isQueryGuid(current.nodeId)) {
    return { ok: false, message: '下一节点编号不完整，没有提交。' }
  }
  if (!current.nodeName.trim()) return { ok: false, message: '起始节点没有名称，没有提交。' }
  return { ok: true, current, next }
}

/** 抓包里提交用的是序号最小的那一档缓急。并列多条时不代选。 */
export function defaultUrgencyId(items: WorkflowUrgency[]): string | null {
  const ranked = items.filter(item => item.seq !== null && isQueryGuid(item.id))
  if (!ranked.length) return null
  const min = Math.min(...ranked.map(item => item.seq ?? 0))
  const picked = ranked.filter(item => item.seq === min)
  return picked.length === 1 ? picked[0].id : null
}

export function readLimitMailCustomer(data: unknown): { ok: true; mailId: string } | { ok: false; kind: 'confirm' | 'rejected' | 'unknown'; message: string } {
  if (!isRecord(data)) return { ok: false, kind: 'unknown', message: '创建发文的响应无法确认，没有再次创建。' }
  if (data.NeedConfirmFillAgency === true) {
    const client = readClientInfo(data.ClientInfo)
    const message = client.ok && client.data.Message ? client.data.Message : 'EASY 要求确认代理机构。'
    return { ok: false, kind: 'confirm', message: `${message} 插件没有代为确认，也没有再次创建。` }
  }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return { ok: false, kind: 'unknown', message: '创建发文的响应无法确认，没有再次创建。' }
  if (client.data.IsLogin === false) return { ok: false, kind: 'rejected', message: 'EASY 登录已失效，请在原网站重新登录。' }
  if (client.data.Status === false) {
    return { ok: false, kind: 'rejected', message: client.data.Message || 'EASY 没有创建这封发文。' }
  }
  if (client.data.Status !== true || typeof data.objid !== 'string' || !isQueryGuid(data.objid)) {
    return { ok: false, kind: 'unknown', message: '创建发文的响应无法确认，没有再次创建。' }
  }
  return { ok: true, mailId: data.objid }
}

export function readMailSubmit(data: unknown): { ok: true } | { ok: false; kind: 'rejected' | 'unknown'; message: string } {
  if (!isRecord(data)) return { ok: false, kind: 'unknown', message: '提交响应无法确认，没有再次提交。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return { ok: false, kind: 'unknown', message: '提交响应无法确认，没有再次提交。' }
  if (client.data.IsLogin === false) return { ok: false, kind: 'rejected', message: 'EASY 登录已失效，请在原网站重新登录。' }
  if (client.data.Result === true && client.data.Status !== false) return { ok: true }
  if (client.data.Result === false) return { ok: false, kind: 'rejected', message: client.data.Message || 'EASY 没有接受这次提交。' }
  return { ok: false, kind: 'unknown', message: '提交响应无法确认，没有再次提交。' }
}

/** 按 2026-09-30 抓到的 Mail.ashx / MailSubmit 组参。空着的评分和期限按那次请求留空，finishdate 写 false。 */
export function buildMailSubmit(input: {
  info: FlowInfoFields
  current: WorkflowNode
  next: WorkflowNode
  reviewer: WorkflowReviewer
  urgencyId: string
}): { params: URLSearchParams | null; blockers: string[] } {
  const blockers: string[] = []
  if (!isQueryGuid(input.info.objId)) blockers.push('邮件编号无效。')
  if (input.info.status === null) blockers.push('当前流程状态缺失。')
  if (!isQueryGuid(input.info.flowId)) blockers.push('流程编号无效。')
  if (!input.info.flowType.trim()) blockers.push('流程类型缺失。')
  if (input.info.flowSubType === null) blockers.push('流程子类型缺失。')
  if (input.current.nodeCode !== 'FIRST') blockers.push('当前节点不是起始节点。')
  if (!input.reviewer.name.trim()) blockers.push('审核人姓名缺失。')
  if (!isQueryGuid(input.reviewer.id) || !isQueryGuid(input.urgencyId)) blockers.push('审核人或缓急编号无效。')
  if (input.next.nodeCode === 'END' || input.next.nodeCode === 'FIRST') blockers.push('下一节点不能是结束或起始。')
  if (input.next.parallel !== false || input.next.needAllAudit !== false || typeof input.next.allowEdit !== 'boolean') {
    blockers.push('下一节点标记不完整。')
  }
  if (blockers.length) return { params: null, blockers }
  const params = new URLSearchParams()
  params.set('handler', 'Mail.ashx')
  params.set('Call', 'MailSubmit')
  params.set('f_audit_type_id', 'submit')
  params.set('f_next_user_id', input.reviewer.id)
  params.set('f_next_user_name', input.reviewer.name.trim())
  params.set('f_remark', '')
  params.set('f_ep_proc', '')
  params.set('f_obj_id', input.info.objId)
  params.set('f_cur_status', String(input.info.status))
  params.set('f_status', '1000')
  params.set('f_allow_edit', input.next.allowEdit ? '1' : '0')
  params.set('f_flow_id', input.info.flowId)
  params.set('f_flow_type', input.info.flowType)
  params.set('f_flow_sub_type', input.info.flowSubType ?? '')
  params.set('f_cur_node_id', input.current.nodeId)
  params.set('f_cur_node_code', input.current.nodeCode)
  params.set('f_next_node_id', input.next.nodeId)
  params.set('f_next_node_code', input.next.nodeCode)
  params.set('f_list_id', input.next.listId)
  params.set('f_cur_node', input.current.nodeName)
  params.set('pic_user', '')
  params.set('int_due_date', '')
  params.set('cus_due_date', '')
  params.set('leg_due_date', '')
  params.set('f_score', '')
  params.set('f_is_parallel', '0')
  params.set('f_urgency_id', input.urgencyId)
  params.set('finishdate', 'false')
  params.set('f_cur_proc_status_fd', '')
  params.set('f_cur_remark_fd', '')
  params.set('f_cur_proc_note_fd', '')
  params.set('log_pagename', FLOW_PAGE)
  return { params, blockers }
}

export function limitMailItems(input: {
  procIds: string[]
  rows: Array<{ procId: string; caseVolume: string }>
  sheetRows: Array<{ ourVolume: string; mailTypeId?: string; customerName?: string; contactName?: string; iprName?: string; leadName?: string }>
  mode: 'ipr' | 'lead'
}): { ok: true; items: LimitMailSubmitItem[] } | { ok: false; message: string } {
  if (!input.procIds.length) return { ok: false, message: '还没有确认勾选。先勾选还没提交审核的事项。' }
  if (input.procIds.length > BATCH_LIMIT) return { ok: false, message: `一次最多提交 ${BATCH_LIMIT} 件。` }
  const items: LimitMailSubmitItem[] = []
  for (const procId of input.procIds) {
    if (!isQueryGuid(procId)) return { ok: false, message: '勾选的事项编号无效，没有提交。' }
    const row = input.rows.find(item => item.procId === procId)
    if (!row) return { ok: false, message: '勾选的事项不在当前列表里，没有提交。' }
    const volume = row.caseVolume.trim().toLowerCase()
    const matched = input.sheetRows.filter(item => item.ourVolume.trim().toLowerCase() === volume && item.mailTypeId && isQueryGuid(item.mailTypeId))
    const types = [...new Set(matched.map(item => item.mailTypeId as string))]
    if (types.length !== 1) {
      return {
        ok: false,
        message: types.length === 0
          ? `文号 ${row.caseVolume} 还没有发文类型，没有提交。`
          : `文号 ${row.caseVolume} 对上了多种发文类型，没有提交。`
      }
    }
    const named = matched.filter(item => input.mode === 'lead' ? lookupName(item.leadName) : lookupName(item.iprName))
    const source = named[0] ?? matched[0]
    const iprName = lookupName(source?.iprName)
    const leadName = lookupName(source?.leadName)
    if (input.mode === 'lead' && !leadName) return { ok: false, message: `文号 ${row.caseVolume} 表格里没有技术负责人，没有提交。` }
    if (!iprName) return { ok: false, message: `文号 ${row.caseVolume} 表格里没有 IPR，没有提交。` }
    items.push({
      procId,
      mailTypeId: types[0],
      mailStyle: '1',
      mode: input.mode,
      customerName: source?.customerName?.trim() ?? '',
      contactName: source?.contactName?.trim() ?? '',
      iprName,
      leadName
    })
  }
  return { ok: true, items }
}

export function readLimitMailLedger(): LimitMailMark[] {
  try {
    const raw = sessionStorage.getItem(LEDGER_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(item => {
      if (!isRecord(item) || !isQueryGuid(String(item.procId))) return []
      const state = item.state === 'created' || item.state === 'submitted' || item.state === 'unknown' ? item.state : null
      if (!state) return []
      const mailId = typeof item.mailId === 'string' && (item.mailId === '' || isQueryGuid(item.mailId)) ? item.mailId : ''
      return [{ procId: String(item.procId), mailId, state }]
    })
  } catch {
    return []
  }
}

export function writeLimitMailMark(mark: LimitMailMark): void {
  const marks = readLimitMailLedger().filter(item => item.procId.toLowerCase() !== mark.procId.toLowerCase())
  marks.push(mark)
  sessionStorage.setItem(LEDGER_KEY, JSON.stringify(marks.slice(-100)))
}

export function forgetLimitMailMark(procId: string): void {
  const marks = readLimitMailLedger().filter(item => item.procId.toLowerCase() !== procId.toLowerCase())
  sessionStorage.setItem(LEDGER_KEY, JSON.stringify(marks.slice(-100)))
}

/** 结束流程后回传是还没提交审核时，不再沿用上次的发文。还在审核里才跳过。 */
export function nextLimitMailAttempt(
  item: LimitMailSubmitItem,
  mark: LimitMailMark | undefined,
  gate: 'open' | 'pending' | 'done' | undefined
): { action: 'send'; item: LimitMailSubmitItem } | { action: 'skip'; reason: 'pending' | 'remembered' } | { action: 'stop'; message: string } {
  if (gate === 'open' || gate === 'done') {
    const fresh = { ...item }
    delete fresh.mailId
    return { action: 'send', item: fresh }
  }
  if (mark?.state === 'submitted') return { action: 'skip', reason: gate === 'pending' ? 'pending' : 'remembered' }
  if (mark?.state === 'unknown') {
    return { action: 'stop', message: '有一件发文的创建或提交结果还没确认，没有再次创建，也没有再次提交。' }
  }
  if (mark?.state === 'created' && mark.mailId) return { action: 'send', item: { ...item, mailId: mark.mailId } }
  return { action: 'send', item }
}

function failed(procId: string, message: string, mailId = ''): LimitMailSubmitResult {
  return { procId, mailId, state: 'failed', message }
}

/** 表格里用来对联系人的名字。拼音括号和补行标记都不参与匹配。 */
function lookupName(raw: string | undefined): string {
  return sheetDisplayName(raw ?? '').replace(/（补）\s*$/, '').trim()
}

function mailInfoParams(mailId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'GetMailInfo')
  params.set('mail_id', mailId)
  params.set('log_pagename', 'mail.aspx')
  return params
}

function cellText(row: Record<string, unknown>, key: string, required: boolean): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return required ? null : ''
  const value = row[key]
  if (typeof value === 'string') return value
  if (value === null) return ''
  return null
}

function zipText(row: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, 'is_zip')) return null
  const value = row.is_zip
  if (value === false || value === 0 || value === '0' || value === '' || value === null) return '0'
  if (value === true || value === 1 || value === '1') return '1'
  return null
}

function saveFields(row: Record<string, unknown>, mailId: string, to: string, cc: string): Record<(typeof SAVE_KEYS)[number], string> | null {
  const mailType = cellText(row, 'mail_type_id', true)
  const customerId = cellText(row, 'customer_id', true)
  const mailsetId = cellText(row, 'mailset_id', true)
  const subject = cellText(row, 'mail_subject', true)
  const body = cellText(row, 'mail_body', true)
  const bcc = cellText(row, 'mail_bcc', true)
  const isZip = zipText(row)
  if (mailType === null || customerId === null || mailsetId === null || subject === null || body === null || bcc === null || isZip === null) return null
  if (!isQueryGuid(mailType) || !isQueryGuid(customerId) || !isQueryGuid(mailsetId)) return null
  const optional = {
    zip_pwd: cellText(row, 'zip_pwd', false),
    renamezip: cellText(row, 'rename_zip', false),
    reply_date: cellText(row, 'reply_date', false),
    proc_ids: cellText(row, 'proc_ids', false),
    express_id: cellText(row, 'express_id', false),
    message_id: cellText(row, 'message_id', false),
    subject_desc: cellText(row, 'subject_desc', false),
    mail_tags: cellText(row, 'mail_tags', false),
    finish_ctrl_proc: cellText(row, 'finish_ctrl_proc', false)
  }
  if (Object.values(optional).some(value => value === null)) return null
  return {
    mail_id: mailId,
    mail_type: mailType,
    customer_id: customerId,
    mailset_id: mailsetId,
    mail_to: to,
    mail_cc: cc,
    mail_bcc: bcc,
    mail_subject: subject,
    mail_body: body,
    is_zip: isZip,
    zip_pwd: optional.zip_pwd ?? '',
    renamezip: optional.renamezip ?? '',
    reply_date: optional.reply_date ?? '',
    proc_ids: optional.proc_ids ?? '',
    express_id: optional.express_id ?? '',
    message_id: optional.message_id ?? '',
    subject_desc: optional.subject_desc ?? '',
    mail_tags: optional.mail_tags ?? '',
    finish_ctrl_proc: optional.finish_ctrl_proc ?? ''
  }
}

function hintRow(item: LimitMailSubmitItem): PctTaskRow {
  return {
    ourVolume: '',
    customerVolume: '',
    customerName: item.customerName,
    contactName: item.contactName,
    iprName: item.iprName,
    leadName: item.leadName,
    procLabel: '',
    mailTypeLabel: ''
  }
}

/** 用发文页联系人对上表格人名，把收件人和抄送写进这封草稿。对不上就不保存。 */
async function writeRecipients(transport: EasyTransport, mailId: string, item: LimitMailSubmitItem): Promise<{ ok: true; note: string } | { ok: false; message: string }> {
  const loaded = await transport.post('getMailInfo', mailInfoParams(mailId))
  if (!loaded.ok) return { ok: false, message: '发文草稿没有读到，没有写入收件人，也没有提交。' }
  const info = readMailInfo(loaded.data, mailId)
  if (!info.ok) return { ok: false, message: info.message }
  const customerId = cellText(info.row, 'customer_id', true)
  if (!customerId || !isQueryGuid(customerId)) return { ok: false, message: '这封发文没有客户编号，没有写入收件人。' }
  const contacts = await loadMailContactText({ mailId, customerId }, (operation, params) => transport.post(operation, params))
  if (!contacts.ok) return { ok: false, message: '发文联系人没有读到，没有写入收件人，也没有提交。' }
  if (!contacts.data.complete) return { ok: false, message: contacts.data.message || '发文联系人没有读全，没有写入收件人，也没有提交。' }
  const sales = contacts.data.rows.filter(row => row.group === 'sales' && row.email.includes('@') && !/[();；]/.test(row.email))
  if (!sales.length) return { ok: false, message: '发文页没有商务邮箱，没有提交。' }
  const existingTo = cellText(info.row, 'mail_to', true)
  const existingCc = cellText(info.row, 'mail_cc', true)
  if (existingTo === null || existingCc === null) return { ok: false, message: '发文草稿的收件人字段读不全，没有改地址。' }
  const plan = planPctRecipients([hintRow(item)], contacts.data.rows, { to: existingTo, cc: existingCc }, new Set(), item.mode)
  const missing = plan.notes[0] || (!plan.to.includes('@') ? '收件人没有对上邮箱，没有提交。' : '')
  const salesInCc = sales.every(row => plan.cc.toLowerCase().includes(row.email.trim().toLowerCase()))
  if (missing || !plan.to.includes('@') || !salesInCc) {
    return { ok: false, message: missing || '商务没有写进抄送，没有提交。' }
  }
  const fields = saveFields(info.row, mailId, plan.to, plan.cc)
  if (!fields) return { ok: false, message: '发文草稿的主题、正文或发件邮箱读不全，没有改地址。' }
  const saved = await transport.post('saveMailInfo', saveParams(fields))
  if (!saved.ok) return { ok: false, message: '保存收件人的响应无法确认，没有提交。再点一次会沿用这封发文，不会重新创建。' }
  const status = readSaveMailInfo(saved.data)
  if (status.status !== 'ok') return { ok: false, message: status.status === 'failed' ? 'EASY 拒绝了这次保存。发文已创建，没有提交。' : '保存收件人的响应无法确认，没有提交。再点一次会沿用这封发文，不会重新创建。' }
  return { ok: true, note: item.mode === 'lead' ? '收件人已写入技术负责人，抄送已含 IPR 和商务。' : '收件人已写入 IPR，抄送已含商务。' }
}

async function submitOne(transport: EasyTransport, userId: string, item: LimitMailSubmitItem): Promise<LimitMailSubmitResult> {
  let mailId = item.mailId ?? ''
  if (!mailId) {
    const params = buildLimitMailCustomerParams(item)
    if (!params.ok) return failed(item.procId, params.error.message)
    const created = await transport.post('limitMailCustomer', params.data)
    if (!created.ok) return { procId: item.procId, mailId: '', state: 'unknown', message: '创建发文的响应无法确认，没有再次创建。' }
    const read = readLimitMailCustomer(created.data)
    if (!read.ok) {
      return {
        procId: item.procId,
        mailId: '',
        state: read.kind === 'unknown' ? 'unknown' : 'failed',
        message: read.message
      }
    }
    mailId = read.mailId
  }

  const addressed = await writeRecipients(transport, mailId, item)
  if (!addressed.ok) return { procId: item.procId, mailId, state: 'created', message: addressed.message }

  const infoParams = flowInfoParams(mailId, 'CO')
  if (!infoParams) return { procId: item.procId, mailId, state: 'created', message: '流程查询参数无效。' }
  const infoResult = await transport.post('getFlowInfo', infoParams)
  if (!infoResult.ok) return { procId: item.procId, mailId, state: 'created', message: infoResult.error.message }
  const info = readFlowInfo(infoResult.data, mailId)
  if (!info.ok) return { procId: item.procId, mailId, state: 'created', message: info.message }
  const nodeParams = flowSubmitQuery(info.info)
  if (!nodeParams) return { procId: item.procId, mailId, state: 'created', message: '当前流程字段不足以读取下一节点。' }
  const nodeResult = await transport.post('getFlowSubmit', nodeParams)
  if (!nodeResult.ok) return { procId: item.procId, mailId, state: 'created', message: nodeResult.error.message }
  const nodes = readFlowSubmit(nodeResult.data)
  if (!nodes.ok) return { procId: item.procId, mailId, state: 'created', message: nodes.message }
  const picked = pickMailSubmitNodes(nodes.nodes)
  if (!picked.ok) return { procId: item.procId, mailId, state: 'created', message: picked.message }
  const reviewer = resolveReviewer(userId, picked.next)
  if (reviewer.status === 'blocked') return { procId: item.procId, mailId, state: 'created', message: `发文已创建。${reviewer.reason}` }

  const urgencyResult = await transport.post('getUrgencyList', urgencyParams())
  if (!urgencyResult.ok) return { procId: item.procId, mailId, state: 'created', message: urgencyResult.error.message }
  const urgency = readUrgency(urgencyResult.data)
  if (!urgency.ok) return { procId: item.procId, mailId, state: 'created', message: urgency.message }
  const urgencyId = defaultUrgencyId(urgency.items)
  if (!urgencyId) return { procId: item.procId, mailId, state: 'created', message: '缓急没有唯一的默认项，没有提交。' }

  const lastParams = lastStatusParams(mailId, info.info.flowType)
  if (!lastParams) return { procId: item.procId, mailId, state: 'created', message: '流程版本查询参数无效。' }
  const lastResult = await transport.post('getFlowLastStatus', lastParams)
  if (!lastResult.ok) return { procId: item.procId, mailId, state: 'created', message: lastResult.error.message }
  const last = readLastStatus(lastResult.data)
  if (!last.ok) return { procId: item.procId, mailId, state: 'created', message: last.message }
  const version = versionAgrees(info.info.status, info.info.updateTimeSs, last.present, last.token)
  if (version !== 'match') return { procId: item.procId, mailId, state: 'created', message: '流程版本对不上，没有提交。' }

  const built = buildMailSubmit({ info: info.info, current: picked.current, next: picked.next, reviewer: reviewer.reviewer, urgencyId })
  if (!built.params) return { procId: item.procId, mailId, state: 'created', message: built.blockers[0] || '提交参数不完整。' }
  const submitted = await transport.post('mailSubmit', built.params)
  if (!submitted.ok) return { procId: item.procId, mailId, state: 'unknown', message: '提交响应无法确认，没有再次提交。' }
  const outcome = readMailSubmit(submitted.data)
  if (!outcome.ok) {
    return {
      procId: item.procId,
      mailId,
      state: outcome.kind === 'unknown' ? 'unknown' : 'created',
      message: outcome.message
    }
  }
  return { procId: item.procId, mailId, state: 'submitted', message: `已提交给当前登录人审核。${addressed.note}` }
}

export async function submitLimitMailBatch(transport: EasyTransport, userId: string, items: LimitMailSubmitItem[]): Promise<{ stopped: boolean; results: LimitMailSubmitResult[] }> {
  if (!isWriteSwitchOpen()) return { stopped: true, results: [{ procId: '', mailId: '', state: 'failed', message: '写开关已关闭，没有提交到 EASY。' }] }
  if (!isQueryGuid(userId)) return { stopped: true, results: [{ procId: '', mailId: '', state: 'failed', message: '当前登录人编号还没确认，没有提交。' }] }
  const results: LimitMailSubmitResult[] = []
  for (const item of items) {
    const result = await submitOne(transport, userId, item)
    results.push(result.message.length > 400 ? { ...result, message: result.message.slice(0, 400) } : result)
    if (result.state !== 'submitted') return { stopped: true, results }
  }
  return { stopped: false, results }
}

export function summarizeLimitMailSubmit(results: LimitMailSubmitResult[], stopped: boolean): string {
  const submitted = results.filter(item => item.state === 'submitted').length
  const last = results[results.length - 1]
  const head = submitted ? `已提交 ${submitted} 件给当前登录人审核。` : '没有提交到审核人。'
  if (!last) return head
  return stopped ? `${head}${last.message}` : head
}

export async function runLimitMailSubmit(
  bridge: MessageBridge,
  userId: string,
  items: LimitMailSubmitItem[],
  gates: Record<string, 'open' | 'pending' | 'done'> = {}
): Promise<string> {
  const ledger = readLimitMailLedger()
  const pending: LimitMailSubmitItem[] = []
  let skipReason: 'pending' | 'remembered' | '' = ''
  for (const item of items) {
    const mark = ledger.find(entry => entry.procId.toLowerCase() === item.procId.toLowerCase())
    const next = nextLimitMailAttempt(item, mark, gates[item.procId])
    if (next.action === 'stop') return next.message
    if (next.action === 'skip') {
      skipReason = next.reason
      continue
    }
    if (mark && (gates[item.procId] === 'open' || gates[item.procId] === 'done')) forgetLimitMailMark(item.procId)
    pending.push(next.item)
  }
  if (!pending.length) {
    if (skipReason === 'pending') return '这些事项还在审核里，没有再创建。'
    return skipReason ? '这些事项已经提交过，没有再创建。' : '没有要提交的事项。'
  }
  const response = await bridge.request({ type: MessageType.SubmitLimitMail, payload: { userId, items: pending } })
  if (response.type === MessageType.Error) return response.payload.message
  if (response.type !== MessageType.SubmitLimitMailResult) return '提交返回了意外结果，没有继续。'
  for (const result of response.payload.results) {
    if (!isQueryGuid(result.procId)) continue
    if (result.state === 'submitted' || result.state === 'unknown' || (result.state === 'created' && result.mailId)) {
      writeLimitMailMark({ procId: result.procId, mailId: result.mailId, state: result.state })
    }
  }
  return summarizeLimitMailSubmit(response.payload.results, response.payload.stopped)
}
