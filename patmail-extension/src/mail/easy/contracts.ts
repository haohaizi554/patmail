import type { ApiResult } from '../../api/types'
import { isQueryGuid } from '../../query/query-validator'
import { isRecord, readClientInfo } from '../../api/response-guards'
import type { MailDraftPreview, SendMode } from '../types'
import type { EasyMailAttachment, EasyMailCase, EasyMailSnapshot, KnownValue, WriteStatus } from './types'

const MAIL_CUSTOMER_PAGE = 'FileSearchMail.aspx'
const MAIL_PAGE = 'mail.aspx'

export function mailStyleValue(mode: SendMode): string | null {
  return mode === 'merge_by_customer_description' ? '1' : null
}

export function buildMailCustomerParams(preview: MailDraftPreview): { ok: true; params: URLSearchParams } | { ok: false; message: string } {
  const style = mailStyleValue(preview.sendMode)
  if (!style) return { ok: false, message: '单个来文的 mailstyle 尚未确认，不能创建。' }
  if (!isQueryGuid(preview.mailTypeId)) return { ok: false, message: '发文类型不是 EASY GUID。' }
  if (preview.fileIds.length === 0 || preview.fileIds.length !== preview.files.length) {
    return { ok: false, message: '文件 ID 与文件名称数量不一致。' }
  }
  const ids: string[] = []
  const names: string[] = []
  for (const file of preview.files) {
    if (!isQueryGuid(file.fileId) || !file.fileName.trim() || file.fileName.includes(';') || ids.includes(file.fileId)) {
      return { ok: false, message: '文件 ID 或名称不能按分号提交。' }
    }
    ids.push(file.fileId)
    names.push(file.fileName)
  }
  const params = new URLSearchParams()
  params.set('Call', 'MailCustomer')
  params.set('_file_ids', ids.join(';'))
  params.set('_file_names', names.join(';'))
  params.set('mailstyle', style)
  params.set('mailtype', preview.mailTypeId)
  params.set('log_pagename', MAIL_CUSTOMER_PAGE)
  return { ok: true, params }
}

/** 已经调用传输层之后，除了发出前就被拒绝的请求，都不能当成可重试的失败。 */
export function unconfirmedWrite(result: ApiResult<unknown>): WriteStatus<never> | null {
  if (result.ok) return null
  if (result.error.code === 'INVALID_ORIGIN' || result.error.code === 'INVALID_QUERY') {
    return { status: 'failed', requestSent: false, message: result.error.message }
  }
  return { status: 'unknown', requestSent: true, message: '请求已经发出，但没有确定的业务结果。不能自动重试，请到 EASY 核对。' }
}

/** 页面成功条件是 objid。正文未保存，缺 objid 时按未知处理，不能重试。 */
export function readMailCustomer(data: unknown): WriteStatus<{ mailId: string }> {
  if (!isRecord(data) || readClientInfo(data.ClientInfo).ok === false) {
    return { status: 'unknown', requestSent: true, message: '创建响应无法确认，不能再次创建。请到 EASY 核对。' }
  }
  const objid = typeof data.objid === 'string' ? data.objid.trim() : ''
  if (!isQueryGuid(objid)) {
    return { status: 'unknown', requestSent: true, message: '响应没有可确认的 objid，不能再次创建。请到 EASY 核对。' }
  }
  return { status: 'ok', data: { mailId: objid } }
}

function known(record: Record<string, unknown>, key: string): KnownValue {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { state: 'unknown', value: null }
  const value = record[key]
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { state: 'known', value: value === null ? null : String(value) }
  }
  return { state: 'unknown', value: null }
}

function blank(): KnownValue {
  return { state: 'unknown', value: null }
}

export function readMailInfo(data: unknown, expectedMailId: string): { ok: true; row: Record<string, unknown> } | { ok: false; message: string } {
  const client = isRecord(data) ? readClientInfo(data.ClientInfo) : null
  if (!client?.ok) return { ok: false, message: 'GetMailInfo 缺少 ClientInfo。' }
  if (client.data.IsLogin === false) return { ok: false, message: 'EASY 登录已失效。' }
  if (client.data.Status === false) return { ok: false, message: 'GetMailInfo 被 EASY 拒绝。' }
  if (!isRecord(data) || !Array.isArray(data.MailInfo) || !isRecord(data.MailInfo[0])) {
    return { ok: false, message: 'GetMailInfo 没有邮件行。' }
  }
  const row = data.MailInfo[0]
  if (typeof row.mail_id !== 'string' || row.mail_id.trim().toLowerCase() !== expectedMailId.trim().toLowerCase()) {
    return { ok: false, message: '返回的邮件 ID 与创建结果不一致。' }
  }
  return { ok: true, row }
}

export function snapshotFromMailInfo(row: Record<string, unknown>, mailId: string): EasyMailSnapshot {
  return {
    mailId,
    customerId: known(row, 'customer_id'),
    customerName: known(row, 'customer_name'),
    mailTypeId: known(row, 'mail_type_id'),
    mailTypeName: known(row, 'mail_type'),
    mailsetId: known(row, 'mailset_id'),
    subject: known(row, 'mail_subject'),
    body: known(row, 'mail_body'),
    to: known(row, 'mail_to'),
    cc: known(row, 'mail_cc'),
    bcc: known(row, 'mail_bcc'),
    subjectDesc: known(row, 'subject_desc'),
    mailTags: known(row, 'mail_tags'),
    isZip: known(row, 'is_zip'),
    zipPwd: known(row, 'zip_pwd'),
    renameZip: known(row, 'rename_zip'),
    replyDate: known(row, 'reply_date'),
    procIds: known(row, 'proc_ids'),
    expressId: known(row, 'express_id'),
    messageId: known(row, 'message_id'),
    finishCtrlProc: known(row, 'finish_ctrl_proc'),
    files: [],
    fileListState: 'unknown',
    cases: [],
    caseListState: 'unknown',
    contacts: [],
    signature: blank(),
    ruleSubject: blank()
  }
}

export function readTableRows(data: unknown, idKey: 'file_id' | 'case_id', nameKey: string): { state: 'known'; rows: Array<{ id: string; name: string }>; total: number | null } | { state: 'unknown' } | { state: 'invalid'; message: string } {
  if (!isRecord(data)) return { state: 'invalid', message: '列表响应不是对象。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { state: 'invalid', message: '列表响应的登录状态无效。' }
  if (data.TableRows === null) return { state: 'unknown' }
  if (!Array.isArray(data.TableRows)) return { state: 'invalid', message: '列表响应没有 TableRows。' }
  const rows: Array<{ id: string; name: string }> = []
  for (const row of data.TableRows) {
    if (!isRecord(row) || typeof row[idKey] !== 'string') return { state: 'invalid', message: '列表行缺少 ID。' }
    rows.push({ id: row[idKey] as string, name: typeof row[nameKey] === 'string' ? row[nameKey] as string : '' })
  }
  const rawTotal = data.TableRowsCount
  const total = typeof rawTotal === 'string' && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null
  return { state: 'known', rows, total }
}

/** 打开已有邮件时，抓包里的 customer_id 等条件为空。不能把本地 Profile ID 填进来。 */
export function readMailInit(data: unknown): { ok: true; mailsetId: KnownValue } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: 'MailinfoInit 响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return { ok: false, message: 'MailinfoInit 缺少 ClientInfo。' }
  if (client.data.IsLogin === false) return { ok: false, message: 'EASY 登录已失效。' }
  if (client.data.Status === false) return { ok: false, message: 'MailinfoInit 被 EASY 拒绝。' }
  let mailsetId: KnownValue = { state: 'unknown', value: null }
  if (Array.isArray(data.mailsettinglist)) {
    const rows = data.mailsettinglist.filter(isRecord)
    const preferred = rows.find(row => row.is_default === true || row.is_default === 1 || row.is_default === '1') ?? rows[0]
    if (preferred && typeof preferred.mailset_id === 'string' && isQueryGuid(preferred.mailset_id)) {
      mailsetId = { state: 'known', value: preferred.mailset_id }
    } else if (rows.length === 0) mailsetId = { state: 'known', value: null }
  }
  return { ok: true, mailsetId }
}

export function signatureParams(mailsetId: string): URLSearchParams | null {
  if (!isQueryGuid(mailsetId)) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetSignature')
  params.set('mailset_id', mailsetId)
  params.set('log_pagename', MAIL_PAGE)
  return params
}

export function contactParams(customerId: string, mailId: string): URLSearchParams | null {
  if (!isQueryGuid(customerId) || !isQueryGuid(mailId)) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetCustomerContact')
  params.set('customer_id', customerId)
  params.set('mail_id', mailId)
  params.set('log_pagename', MAIL_PAGE)
  return params
}

/** mail_type 是显示名，不是 GUID。case_id 与 proc_id 在已核对的请求里为空。 */
export function ruleParams(input: { mailId: string; customerId: string; mailTypeId: string; mailTypeName: string }): URLSearchParams | null {
  if (![input.mailId, input.customerId, input.mailTypeId].every(isQueryGuid)) return null
  if (!input.mailTypeName.trim()) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetMailRule')
  params.set('mail_id', input.mailId)
  params.set('customer_id', input.customerId)
  params.set('mail_type_id', input.mailTypeId)
  params.set('case_id', '')
  params.set('proc_id', '')
  params.set('mail_type', input.mailTypeName)
  params.set('log_pagename', MAIL_PAGE)
  return params
}

/** 抓包格式是「名称(邮箱);」。没有显示名时不能改成只提交邮箱。 */
export function formatRecipientList(emails: string[], contacts: Array<{ name: string; email: string }>): { value: string; blocked: boolean; reason: string } {
  if (emails.length === 0) return { value: '', blocked: false, reason: '' }
  const parts: string[] = []
  for (const email of emails) {
    const contact = contacts.find(item => item.email.trim().toLowerCase() === email.trim().toLowerCase())
    const name = contact?.name.trim() ?? ''
    if (!name || /[;()]/.test(name) || /[;()]/.test(email)) {
      return { value: '', blocked: true, reason: '收件人缺少已核对的「名称(邮箱);」格式，不能提交。' }
    }
    parts.push(`${name}(${email.trim()});`)
  }
  return { value: parts.join(''), blocked: false, reason: '' }
}

export interface NamedAddress {
  name: string
  email: string
}

function addressToken(piece: string): NamedAddress | { raw: string } | null {
  const text = piece.trim()
  if (!text) return null
  const angle = text.match(/^(.*)<([^<>]+)>$/)
  if (angle?.[2]?.includes('@')) return { name: angle[1].trim(), email: angle[2].trim() }
  const paren = text.match(/^(.*)\(([^()]*)\)$/)
  if (paren?.[2]?.includes('@')) return { name: paren[1].trim(), email: paren[2].trim() }
  if (text.includes('@') && !/[();]/.test(text)) return { name: '', email: text }
  return { raw: text }
}

function addressKey(email: string): string {
  return email.trim().toLowerCase()
}

/** 已有地址留在前面。后加的人按邮箱去重，不改写加载发文时预填的内容。 */
export function appendRecipientField(existing: string, addition: string): string {
  const tokens: Array<NamedAddress | { raw: string }> = []
  const seen = new Set<string>()
  const take = (token: NamedAddress | { raw: string } | null) => {
    if (!token) return
    if ('raw' in token) {
      tokens.push(token)
      return
    }
    const key = addressKey(token.email)
    if (!key || seen.has(key)) return
    seen.add(key)
    tokens.push(token)
  }
  for (const piece of `${existing};${addition}`.split(/[;；]/)) take(addressToken(piece))
  return tokens.map(token => 'raw' in token ? `${token.raw};` : token.name ? `${token.name}(${token.email});` : `${token.email};`).join('')
}

export function readCustomerContacts(data: unknown): { ok: true; contacts: Array<{ name: string; email: string }> } | { ok: false; message: string } {
  if (!isRecord(data)) return { ok: false, message: '联系人响应无效。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取联系人时登录已失效。' }
  if (data.CustomerContact === null) return { ok: true, contacts: [] }
  if (!Array.isArray(data.CustomerContact)) return { ok: false, message: 'CustomerContact 结构未知。' }
  const contacts = data.CustomerContact.flatMap(row => {
    if (!isRecord(row) || typeof row.email !== 'string') return []
    return [{ name: typeof row.contact_name === 'string' ? row.contact_name : '', email: row.email }]
  })
  return { ok: true, contacts }
}

export function readSignature(data: unknown): KnownValue {
  if (!isRecord(data) || !Array.isArray(data.Signature) || !isRecord(data.Signature[0])) return { state: 'unknown', value: null }
  const content = data.Signature[0].signature_content
  return typeof content === 'string' ? { state: 'known', value: content } : { state: 'unknown', value: null }
}

export function readRuleSubject(data: unknown): KnownValue {
  if (!isRecord(data) || !isRecord(data.subject) || !Object.prototype.hasOwnProperty.call(data.subject, 'subject')) {
    return { state: 'unknown', value: null }
  }
  const value = data.subject.subject
  return typeof value === 'string' ? { state: 'known', value } : { state: 'unknown', value: null }
}

export function applyFiles(snapshot: EasyMailSnapshot, rows: Array<{ id: string; name: string }>): EasyMailSnapshot {
  return { ...snapshot, fileListState: 'known', files: rows.map(row => ({ fileId: row.id, fileName: row.name })) }
}

export function applyCases(snapshot: EasyMailSnapshot, rows: Array<{ id: string; name: string }>): EasyMailSnapshot {
  return { ...snapshot, caseListState: 'known', cases: rows.map(row => ({ caseId: row.id, caseVolume: row.name })) }
}

export const SAVE_KEYS = [
  'mail_id', 'mail_type', 'customer_id', 'mailset_id', 'mail_to', 'mail_cc', 'mail_bcc',
  'mail_subject', 'mail_body', 'is_zip', 'zip_pwd', 'renamezip', 'reply_date', 'proc_ids',
  'express_id', 'message_id', 'subject_desc', 'mail_tags', 'finish_ctrl_proc'
] as const

export function readSaveMailInfo(data: unknown): WriteStatus<{ saved: true }> {
  if (!isRecord(data)) return { status: 'unknown', requestSent: true, message: '保存响应无法确认，不能重试。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return { status: 'unknown', requestSent: true, message: '保存响应无法确认，不能重试。' }
  if (client.data.Status === true) return { status: 'ok', data: { saved: true } }
  if (client.data.Status === false) return { status: 'failed', requestSent: true, message: 'EASY 拒绝了这次保存。请先读取邮件，不要直接重试。' }
  return { status: 'unknown', requestSent: true, message: '保存响应没有明确的 Status，不能重试。' }
}

export function saveParams(fields: Record<(typeof SAVE_KEYS)[number], string>): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'SaveMailInfo')
  for (const key of SAVE_KEYS) params.set(key, fields[key])
  params.set('log_pagename', MAIL_PAGE)
  return params
}

export function relatedFileParams(mailId: string, fileIds: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'SaveMailRalteCaseFile')
  params.set('file_ids', fileIds)
  params.set('mail_id', mailId)
  params.set('log_pagename', MAIL_PAGE)
  return params
}

export function readRelatedFiles(data: unknown): WriteStatus<{ accepted: true }> {
  if (!isRecord(data)) return { status: 'unknown', requestSent: true, message: '文件关联响应无法确认。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.Status !== true) {
    return { status: 'unknown', requestSent: true, message: '文件关联的成功条件尚未在响应正文里核对。' }
  }
  return { status: 'unknown', requestSent: true, message: '即使 Status 为真，也要重新读取文件列表后才能算关联完成。' }
}

export function filesMatch(expected: string[], actual: EasyMailAttachment[]): boolean {
  const left = [...expected].map(id => id.toLowerCase()).sort()
  const right = actual.map(file => file.fileId.toLowerCase()).sort()
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function listParams(call: 'GetMailFile' | 'GetMailCase', mailId: string, pageIndex: number): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', call)
  params.set('mail_id', mailId)
  params.set('pageIndex', String(pageIndex))
  params.set('searchKey', '')
  params.set('log_pagename', MAIL_PAGE)
  if (call === 'GetMailFile') {
    params.set('pageSize', '5')
    params.set('_PK', 'file_id')
    params.set('colsel', ';is_ralte_mail;file_name;file_type;upload_user;undefined;upload_time;customer_id;')
  } else {
    params.set('pageSize', '100')
    params.set('_PK', 'mail_case_id')
    params.set('colsel', ';sn;case_volume;ctrl_proc;case_name;case_volume_customer;app_no;issue_no;register_type_code;legal_due_date;customer_id;')
  }
  return params
}

export function initParams(mailId: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'MailinfoInit')
  params.set('mail_id', mailId)
  params.set('case_id', '')
  params.set('proc_id', '')
  params.set('file_ids', '')
  params.set('customer_id', '')
  params.set('log_pagename', MAIL_PAGE)
  return params
}
