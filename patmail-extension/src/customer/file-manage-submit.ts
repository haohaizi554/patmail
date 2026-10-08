import type { EasyTransport } from '../api/transport'
import { isRecord } from '../api/response-guards'
import { appendRecipientField, buildMailCustomerParams, readMailCustomer, readMailInfo, readSaveMailInfo, SAVE_KEYS, saveParams, signatureParams } from '../mail/easy/contracts'
import { loadMailContactText } from '../mail/easy/mail-contacts'
import { operatorSignatureHtml, readSignatureHtml } from '../mail/easy/signature-read'
import type { MailDraftPreview } from '../mail/types'
import { isQueryGuid } from '../query/query-validator'
import { isWriteSwitchOpen } from '../settings/write-switch'
import type { MessageBridge } from '../shared/message'
import { MessageType } from '../shared/message'
import {
  flowInfoParams,
  flowSubmitQuery,
  lastStatusParams,
  readFlowInfo,
  readFlowSubmit,
  readLastStatus,
  readUrgency,
  urgencyParams,
  versionAgrees
} from '../workflow/contracts'
import type { WorkflowNode } from '../workflow/types'
import { bodyWithSignature } from './file-manage-plan'
import { bodyWithRndInventors } from './mail-inventor-column'
import { buildMailSubmit, defaultUrgencyId, pickMailSubmitNodes, readMailSubmit } from './limit-mail-submit'

const LEDGER_KEY = 'patmail.fileManageSubmit.v1'
const BAD_ADDRESS = /[();；]/

export interface FileManageSubmitItem {
  fileId: string
  fileIds: string[]
  fileNames: string[]
  mailTypeId: string
  mailStyle: '1'
  mailId?: string
  /** 本地记过已提交。先读这封邮件现在的流程，再决定沿用还是另建。 */
  recall?: boolean
  subject: string
  senderId: string
  senderName: string
  senderEmail: string
  reviewerId: string
  reviewerName: string
  /** 原站签名是下拉项编号。操作员签名是要写成 HTML 的正文。 */
  signature: string
}

export interface FileManageSubmitResult {
  fileId: string
  mailId: string
  state: 'submitted' | 'created' | 'unknown' | 'failed'
  message: string
}

export interface FileManageMark {
  fileId: string
  mailId: string
  state: 'created' | 'submitted' | 'unknown'
}

export function fileIdsOf(item: { fileId: string; fileIds?: string[] }): string[] {
  const ids = item.fileIds?.length ? item.fileIds : [item.fileId]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(id)
  }
  return out
}

function sessionLedgerArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return null
  return chrome.storage.session
}

function parseMarks(value: unknown): FileManageMark[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!isRecord(item) || !isQueryGuid(String(item.fileId))) return []
    const state = item.state === 'created' || item.state === 'submitted' || item.state === 'unknown' ? item.state : ''
    if (!state) return []
    const mailId = typeof item.mailId === 'string' && (item.mailId === '' || isQueryGuid(item.mailId)) ? item.mailId : ''
    return [{ fileId: String(item.fileId), mailId, state }]
  })
}

function readSessionLedger(): FileManageMark[] {
  try {
    const raw = sessionStorage.getItem(LEDGER_KEY)
    return raw ? parseMarks(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

let memoryMarks: FileManageMark[] | null = null
const droppedMarks = new Set<string>()
let ledgerQueue: Promise<void> = Promise.resolve()

export function readFileManageLedger(): FileManageMark[] {
  return memoryMarks ?? readSessionLedger()
}

export async function loadFileManageLedger(): Promise<FileManageMark[]> {
  const area = sessionLedgerArea()
  if (!area) {
    memoryMarks = readSessionLedger()
    return memoryMarks
  }
  try {
    const stored = await area.get(LEDGER_KEY)
    memoryMarks = parseMarks(stored[LEDGER_KEY])
  } catch {
    memoryMarks = readSessionLedger()
  }
  return memoryMarks
}

function flushLedger(): Promise<void> {
  const job = ledgerQueue.then(async () => {
    const local = memoryMarks ? memoryMarks.slice() : readSessionLedger()
    const tombstones = [...droppedMarks]
    const area = sessionLedgerArea()
    if (!area) {
      sessionStorage.setItem(LEDGER_KEY, JSON.stringify(local.slice(-500)))
      return
    }
    const stored = parseMarks((await area.get(LEDGER_KEY))[LEDGER_KEY])
    const merged = new Map<string, FileManageMark>()
    for (const item of stored) {
      if (tombstones.includes(item.fileId.toLowerCase())) continue
      merged.set(item.fileId.toLowerCase(), item)
    }
    for (const item of local) {
      if (tombstones.includes(item.fileId.toLowerCase())) continue
      merged.set(item.fileId.toLowerCase(), item)
    }
    const next = [...merged.values()].slice(-500)
    memoryMarks = next
    for (const id of tombstones) droppedMarks.delete(id)
    await area.set({ [LEDGER_KEY]: next })
  }).catch(() => {})
  ledgerQueue = job
  return job
}

export function writeFileManageMark(mark: FileManageMark): void {
  const id = mark.fileId.toLowerCase()
  droppedMarks.delete(id)
  const marks = readFileManageLedger().filter(item => item.fileId.toLowerCase() !== id)
  marks.push(mark)
  memoryMarks = marks.slice(-500)
  void flushLedger()
}

/** 本地记过已提交时，带上那封邮件去读现在的流程。结果没确认的停住。创建过但没提交的沿用那封。 */
export function nextFileManageAttempt(
  item: FileManageSubmitItem,
  mark: FileManageMark | undefined
): { action: 'send'; item: FileManageSubmitItem } | { action: 'skip' } | { action: 'stop'; message: string } {
  if (mark?.state === 'submitted' && mark.mailId) return { action: 'send', item: { ...item, mailId: mark.mailId, recall: true } }
  if (mark?.state === 'unknown') {
    return { action: 'stop', message: '有一封发文的创建或提交结果还没确认，没有再次创建，也没有再次提交。' }
  }
  if (mark?.state === 'created' && mark.mailId) return { action: 'send', item: { ...item, mailId: mark.mailId } }
  return { action: 'send', item }
}

/** 当前节点是结束才算办完。没有节点就当作这封流程已经不在。 */
export function classifyMailFlow(nodeCode: string | null, curNodeId: string | null): 'pending' | 'done' | 'open' {
  const code = (nodeCode ?? '').trim().toUpperCase()
  if (code === 'END') return 'done'
  if (!code && !(curNodeId ?? '').trim()) return 'open'
  return 'pending'
}

/** 写得成的人留下。姓名或邮箱写不成「名称(邮箱);」的跳过，不因此停住整封。 */
export function formatPeople(rows: Array<{ name: string; email: string }>): { value: string; skipped: string[] } {
  const parts: string[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    const email = row.email.trim()
    if (!email) continue
    if (!name || !email.includes('@') || BAD_ADDRESS.test(name) || BAD_ADDRESS.test(email)) {
      skipped.push((name || email).slice(0, 40))
      continue
    }
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(`${name}(${email});`)
  }
  return { value: parts.join(''), skipped }
}

export function matchConfiguredReviewer(reviewerId: string, node: WorkflowNode): { ok: true; id: string; name: string } | { ok: false; message: string } {
  if (!isQueryGuid(reviewerId)) return { ok: false, message: '还没有默认审核人。' }
  if (node.reviewerFormat === 'unknown' || node.reviewers.length === 0) {
    return { ok: false, message: '下一节点没有已确认的审核人，没有提交。' }
  }
  const match = node.reviewers.find(item => item.id.toLowerCase() === reviewerId.toLowerCase())
  if (!match || !match.name.trim()) return { ok: false, message: '默认审核人不在下一节点的候选人里，没有提交。' }
  return { ok: true, id: match.id, name: match.name.trim() }
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

function saveFields(row: Record<string, unknown>, item: FileManageSubmitItem, mailId: string, to: string, cc: string, signatureHtml: string): Record<(typeof SAVE_KEYS)[number], string> | null {
  const mailType = cellText(row, 'mail_type_id', true)
  const customerId = cellText(row, 'customer_id', true)
  const mailsetId = cellText(row, 'mailset_id', true)
  const subject = cellText(row, 'mail_subject', true)
  const body = cellText(row, 'mail_body', true)
  const bcc = cellText(row, 'mail_bcc', true)
  const isZip = zipText(row)
  if (mailType === null || customerId === null || mailsetId === null || subject === null || body === null || bcc === null || isZip === null) return null
  if (!isQueryGuid(mailType) || !isQueryGuid(customerId) || !isQueryGuid(item.senderId)) return null
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
    mailset_id: item.senderId,
    mail_to: to,
    mail_cc: cc,
    mail_bcc: bcc,
    mail_subject: item.subject,
    mail_body: bodyWithSignature(body, signatureHtml),
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

function previewOf(item: FileManageSubmitItem): MailDraftPreview {
  return {
    id: item.fileId,
    customerProfileId: '',
    fileIds: fileIdsOf(item),
    files: fileIdsOf(item).map((fileId, index) => ({
      fileId,
      fileName: item.fileNames[index] ?? '',
      fileDescription: '',
      customerName: ''
    })),
    mailTypeId: item.mailTypeId,
    mailTypeName: '',
    to: [],
    cc: [],
    subject: item.subject,
    body: '',
    signature: '',
    sendMode: 'merge_by_customer_description',
    status: 'ready',
    issues: [],
    ruleVersions: {},
    fingerprint: ''
  }
}

function spread(item: FileManageSubmitItem, result: FileManageSubmitResult): FileManageSubmitResult[] {
  return fileIdsOf(item).map(fileId => ({ ...result, fileId }))
}

function failed(item: FileManageSubmitItem, message: string, mailId = ''): FileManageSubmitResult[] {
  return spread(item, { fileId: item.fileId, mailId, state: 'failed', message })
}

async function signatureHtmlOf(transport: EasyTransport, item: FileManageSubmitItem): Promise<{ ok: true; html: string } | { ok: false; message: string }> {
  const raw = item.signature.trim()
  if (!raw) return { ok: false, message: '还没有默认签名，没有提交。' }
  if (!isQueryGuid(raw)) {
    const html = operatorSignatureHtml(raw)
    return html ? { ok: true, html } : { ok: false, message: '还没有默认签名，没有提交。' }
  }
  const params = signatureParams(item.senderId)
  if (!params) return { ok: false, message: '发件邮箱编号无效，邮件签名没有读到，没有提交。' }
  const loaded = await transport.post('getSignature', params)
  if (!loaded.ok) return { ok: false, message: '邮件签名没有读到，没有提交。' }
  const html = readSignatureHtml(loaded.data, raw)
  if (!html) return { ok: false, message: '发文页的邮件签名下拉里没有这条默认签名，没有提交。' }
  return { ok: true, html }
}

async function mailFlowGate(transport: EasyTransport, mailId: string): Promise<'pending' | 'done' | 'open' | 'unread'> {
  const params = flowInfoParams(mailId, 'CO')
  if (!params) return 'unread'
  const result = await transport.post('getFlowInfo', params)
  if (!result.ok) return 'unread'
  const info = readFlowInfo(result.data, mailId)
  if (!info.ok) return 'unread'
  return classifyMailFlow(info.info.nodeCode, info.info.curNodeId)
}

async function writeLetter(transport: EasyTransport, mailId: string, item: FileManageSubmitItem): Promise<{ ok: true; note: string } | { ok: false; message: string }> {
  const loaded = await transport.post('getMailInfo', mailInfoParams(mailId))
  if (!loaded.ok) return { ok: false, message: '发文草稿没有读到，没有写入收件人，也没有提交。' }
  const info = readMailInfo(loaded.data, mailId)
  if (!info.ok) return { ok: false, message: info.message }
  const customerId = cellText(info.row, 'customer_id', true)
  if (!customerId || !isQueryGuid(customerId)) return { ok: false, message: '这封发文没有客户编号，没有写入收件人。' }
  const contacts = await loadMailContactText({ mailId, customerId }, (operation, params) => transport.post(operation, params))
  if (!contacts.ok) return { ok: false, message: '发文联系人没有读到，没有写入收件人，也没有提交。' }
  if (!contacts.data.complete) return { ok: false, message: contacts.data.message || '发文联系人没有读全，没有写入收件人，也没有提交。' }
  const cases = contacts.data.rows.filter(row => row.group === 'case')
  const sales = contacts.data.rows.filter(row => row.group === 'sales')
  const to = formatPeople(cases)
  if (!to.value) {
    const who = to.skipped[0]
    return { ok: false, message: who ? `案件联系人「${who}」的姓名或邮箱不能写成「名称(邮箱);」，没有可以写入的收件人，没有提交。` : '发文页没有案件联系人邮箱，没有提交。' }
  }
  const business = formatPeople(sales)
  const sender = formatPeople([{ name: item.senderName, email: item.senderEmail }])
  const cc = appendRecipientField(sender.value, business.value)
  const signature = await signatureHtmlOf(transport, item)
  if (!signature.ok) return signature
  const rawBody = typeof info.row.mail_body === 'string' ? info.row.mail_body : ''
  const withInventors = await bodyWithRndInventors(transport, mailId, rawBody)
  if (!withInventors.ok) return withInventors
  const row = withInventors.html === rawBody ? info.row : { ...info.row, mail_body: withInventors.html }
  const fields = saveFields(row, item, mailId, to.value, cc, signature.html)
  if (!fields) return { ok: false, message: '发文草稿的主题、正文或发件邮箱读不全，没有改地址。' }
  const saved = await transport.post('saveMailInfo', saveParams(fields))
  if (!saved.ok) return { ok: false, message: '保存收件人的响应无法确认，没有提交。再点一次会沿用这封发文，不会重新创建。' }
  const status = readSaveMailInfo(saved.data)
  if (status.status !== 'ok') {
    return { ok: false, message: status.status === 'failed' ? 'EASY 拒绝了这次保存。发文已创建，没有提交。' : '保存收件人的响应无法确认，没有提交。再点一次会沿用这封发文，不会重新创建。' }
  }
  const skipped = [...to.skipped, ...business.skipped, ...sender.skipped]
  const left = skipped.length ? `写不成的没有写入：${skipped.join('、')}。` : ''
  const inventors = withInventors.note ? `${withInventors.note}` : ''
  return { ok: true, note: `收件人是案件联系人，抄送是默认发件人和商务，正文写入发文页邮件签名下拉里的格式。${inventors}${left}` }
}

function mailInfoParams(mailId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'GetMailInfo')
  params.set('mail_id', mailId)
  params.set('log_pagename', 'mail.aspx')
  return params
}

async function submitOne(transport: EasyTransport, item: FileManageSubmitItem): Promise<FileManageSubmitResult[]> {
  let mailId = item.mailId ?? ''
  if (item.recall && mailId) {
    const gate = await mailFlowGate(transport, mailId)
    if (gate === 'unread') return spread(item, { fileId: item.fileId, mailId, state: 'unknown', message: '发文状态没有读到，没有再创建。' })
    if (gate === 'pending') return spread(item, { fileId: item.fileId, mailId, state: 'failed', message: '这封还在审核里，没有再创建。' })
    mailId = ''
  }
  if (!mailId) {
    const params = buildMailCustomerParams(previewOf(item))
    if (!params.ok) return failed(item, params.message)
    const created = await transport.post('mailCustomer', params.params)
    if (!created.ok) return spread(item, { fileId: item.fileId, mailId: '', state: 'unknown', message: '创建发文的响应无法确认，没有再次创建。' })
    const read = readMailCustomer(created.data)
    if (read.status !== 'ok') {
      return spread(item, { fileId: item.fileId, mailId: '', state: 'unknown', message: read.message })
    }
    mailId = read.data.mailId
  }
  const addressed = await writeLetter(transport, mailId, item)
  if (!addressed.ok) return spread(item, { fileId: item.fileId, mailId, state: 'created', message: addressed.message })
  const held = (message: string, state: FileManageSubmitResult['state'] = 'created'): FileManageSubmitResult[] => spread(item, { fileId: item.fileId, mailId, state, message })
  const infoParams = flowInfoParams(mailId, 'CO')
  if (!infoParams) return held('流程查询参数无效。')
  const infoResult = await transport.post('getFlowInfo', infoParams)
  if (!infoResult.ok) return held(infoResult.error.message)
  const info = readFlowInfo(infoResult.data, mailId)
  if (!info.ok) return held(info.message)
  const nodeParams = flowSubmitQuery(info.info)
  if (!nodeParams) return held('当前流程字段不足以读取下一节点。')
  const nodeResult = await transport.post('getFlowSubmit', nodeParams)
  if (!nodeResult.ok) return held(nodeResult.error.message)
  const nodes = readFlowSubmit(nodeResult.data)
  if (!nodes.ok) return held(nodes.message)
  const picked = pickMailSubmitNodes(nodes.nodes)
  if (!picked.ok) return held(picked.message)
  const reviewer = matchConfiguredReviewer(item.reviewerId, picked.next)
  if (!reviewer.ok) return held(`发文已创建。${reviewer.message}`)
  const urgencyResult = await transport.post('getUrgencyList', urgencyParams())
  if (!urgencyResult.ok) return held(urgencyResult.error.message)
  const urgency = readUrgency(urgencyResult.data)
  if (!urgency.ok) return held(urgency.message)
  const urgencyId = defaultUrgencyId(urgency.items)
  if (!urgencyId) return held('缓急没有唯一的默认项，没有提交。')
  const lastParams = lastStatusParams(mailId, info.info.flowType)
  if (!lastParams) return held('流程版本查询参数无效。')
  const lastResult = await transport.post('getFlowLastStatus', lastParams)
  if (!lastResult.ok) return held(lastResult.error.message)
  const last = readLastStatus(lastResult.data)
  if (!last.ok) return held(last.message)
  const version = versionAgrees(info.info.status, info.info.updateTimeSs, last.present, last.token)
  if (version !== 'match') return held('流程版本对不上，没有提交。')
  const built = buildMailSubmit({
    info: info.info,
    current: picked.current,
    next: picked.next,
    reviewer: { id: reviewer.id, name: reviewer.name },
    urgencyId
  })
  if (!built.params) return held(built.blockers[0] || '提交参数不完整。')
  const submitted = await transport.post('mailSubmit', built.params)
  if (!submitted.ok) return held('提交响应无法确认，没有再次提交。', 'unknown')
  const outcome = readMailSubmit(submitted.data)
  if (!outcome.ok) return held(outcome.message, outcome.kind === 'unknown' ? 'unknown' : 'created')
  const count = fileIdsOf(item).length
  const head = count > 1 ? `已把 ${count} 个文件合成一封，提交给默认审核人。` : '已提交给默认审核人。'
  return held(`${head}${addressed.note}`, 'submitted')
}

export async function submitFileManageBatch(transport: EasyTransport, items: FileManageSubmitItem[]): Promise<{ stopped: boolean; results: FileManageSubmitResult[] }> {
  if (!isWriteSwitchOpen()) return { stopped: true, results: [{ fileId: '', mailId: '', state: 'failed', message: '写开关已关闭，没有提交到 EASY。' }] }
  const results: FileManageSubmitResult[] = []
  const finish = async (stopped: boolean): Promise<{ stopped: boolean; results: FileManageSubmitResult[] }> => {
    for (const result of results) {
      if (!isQueryGuid(result.fileId)) continue
      if (result.state === 'submitted' || result.state === 'unknown' || (result.state === 'created' && result.mailId)) {
        writeFileManageMark({ fileId: result.fileId, mailId: result.mailId, state: result.state })
      }
    }
    await ledgerQueue
    return { stopped, results }
  }
  for (const item of items) {
    const letter = await submitOne(transport, item)
    results.push(...letter.map(result => result.message.length > 8000 ? { ...result, message: result.message.slice(0, 8000) } : result))
    const reviewing = letter.length > 0 && letter.every(result => result.message.includes('还在审核里'))
    if (!reviewing && letter.some(result => result.state !== 'submitted')) return finish(true)
  }
  return finish(false)
}

export function summarizeFileManageSubmit(results: FileManageSubmitResult[], stopped: boolean): string {
  const submitted = results.filter(item => item.state === 'submitted')
  const letters = new Set(submitted.map(item => item.mailId).filter(Boolean)).size
  const last = results[results.length - 1]
  const head = !submitted.length
    ? '没有提交到审核人。'
    : `已提交 ${letters} 封给默认审核人。`
  if (!last) return head
  return stopped ? `${head}${last.message}` : head
}

export function fileManageSubmitShouldHalt(text: string): boolean {
  if (text.includes('不能写成') || text.includes('还在审核里')) return false
  return /无法确认|没有再次|写开关|没有提交到审核人|登录已失效/.test(text) && !text.startsWith('已提交')
}

function remember(results: FileManageSubmitResult[]): void {
  for (const result of results) {
    if (!isQueryGuid(result.fileId)) continue
    if (result.state === 'submitted' || result.state === 'unknown' || (result.state === 'created' && result.mailId)) {
      writeFileManageMark({ fileId: result.fileId, mailId: result.mailId, state: result.state })
    }
  }
}

/** 按文件编号沿用上次没完成的发文。记过已提交的先拿邮件编号去读现在的流程。 */
export async function runFileManageSubmit(bridge: MessageBridge, userId: string, items: FileManageSubmitItem[]): Promise<string> {
  await loadFileManageLedger()
  const ledger = readFileManageLedger()
  const pending: FileManageSubmitItem[] = []
  let skipped = false
  for (const item of items) {
    const fresh: string[] = []
    const freshNames: string[] = []
    const reused = new Map<string, { ids: string[]; names: string[]; recall: boolean }>()
    let blocked = false
    const ids = fileIdsOf(item)
    for (const fileId of ids) {
      const index = ids.indexOf(fileId)
      const single: FileManageSubmitItem = { ...item, fileId, fileIds: [fileId], fileNames: [item.fileNames[index] ?? ''] }
      delete single.mailId
      delete single.recall
      const mark = ledger.find(entry => entry.fileId.toLowerCase() === fileId.toLowerCase())
      const next = nextFileManageAttempt(single, mark)
      if (next.action === 'stop') return next.message
      if (next.action === 'skip') {
        skipped = true
        blocked = true
        continue
      }
      if (next.item.mailId) {
        const list = reused.get(next.item.mailId) ?? { ids: [], names: [], recall: false }
        list.ids.push(fileId)
        list.names.push(item.fileNames[index] ?? '')
        if (next.item.recall) list.recall = true
        reused.set(next.item.mailId, list)
      } else {
        fresh.push(fileId)
        freshNames.push(item.fileNames[index] ?? '')
      }
    }
    if (fresh.length) {
      const nextItem: FileManageSubmitItem = { ...item, fileId: fresh[0], fileIds: fresh, fileNames: freshNames }
      delete nextItem.mailId
      delete nextItem.recall
      pending.push(nextItem)
    }
    for (const [mailId, group] of reused) {
      const nextItem: FileManageSubmitItem = { ...item, fileId: group.ids[0], fileIds: group.ids, fileNames: group.names, mailId }
      delete nextItem.recall
      if (group.recall) nextItem.recall = true
      pending.push(nextItem)
    }
    if (!fresh.length && reused.size === 0 && !blocked && !ids.length) skipped = true
  }
  if (!pending.length) return skipped ? '这些文件已经提交过，没有再创建。' : '没有要提交的文件。'
  const response = await bridge.request({ type: MessageType.SubmitFileManage, payload: { userId, items: pending } })
  if (response.type === MessageType.Error) return response.payload.message
  if (response.type !== MessageType.SubmitFileManageResult) return '提交返回了意外结果，没有继续。'
  remember(response.payload.results)
  await ledgerQueue
  return summarizeFileManageSubmit(response.payload.results, response.payload.stopped)
}
