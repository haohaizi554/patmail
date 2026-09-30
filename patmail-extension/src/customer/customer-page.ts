import { isRecord, readClientInfo } from '../api/response-guards'
import { apiError, type ApiResult } from '../api/types'
import { appendRecipientField } from '../mail/easy/contracts'
import { sheetRecipientNames, type PctRecipientMode } from './pct-recipients'
import { isQueryGuid } from '../query/query-validator'
import type { PctTaskRow } from './types'

const PAGE = 'Addcustomer.aspx'
const PAGE_SIZE = 10
const MAX_PAGES = 20
const FIELD_LIMIT = 20_000

/** 客户资料页要求表的一行。描述按页面弹层做了 HTML 解码，标签仍留在原文里。 */
export interface CustomerDemandRow {
  demandId: string
  caseType: string
  demandType: string
  title: string
  description: string
  fileName: string
  disabled: boolean
}

export interface CustomerDemandAsset {
  customerId: string
  rows: CustomerDemandRow[]
  text: string
  complete: boolean
  message: string
}

/** 客户资料页联系人。只留姓名、邮箱和联系人类型，不带走电话和地址。 */
export interface CustomerDirectoryContact {
  contactId: string
  name: string
  email: string
  contactType: string
}

export interface CustomerDirectoryAsset {
  customerId: string
  rows: CustomerDirectoryContact[]
  complete: boolean
  message: string
}

type SheetPage<T> = { state: 'known'; rows: T[]; total: number | null } | { state: 'unknown'; message: string } | { state: 'invalid'; message: string }

function cell(row: Record<string, unknown>, key: string): { ok: true; value: string } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === null) return { ok: true, value: '' }
  if (typeof row[key] !== 'string') return { ok: false }
  return { ok: true, value: row[key].slice(0, FIELD_LIMIT) }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (raw, digits: string) => {
      const code = Number(digits)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : raw
    })
    .replace(/&#x([0-9a-f]+);/gi, (raw, digits: string) => {
      const code = Number.parseInt(digits, 16)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : raw
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function sheetParams(call: string, customerId: string, pageIndex: number, primaryKey: string, columns: string): URLSearchParams | null {
  if (!isQueryGuid(customerId) || !Number.isInteger(pageIndex) || pageIndex < 1) return null
  const params = new URLSearchParams()
  params.set('Call', call)
  params.set('customer_id', customerId)
  params.set('pageIndex', String(pageIndex))
  params.set('pageSize', String(PAGE_SIZE))
  params.set('searchKey', '')
  params.set('_PK', primaryKey)
  params.set('colsel', columns)
  params.set('log_pagename', PAGE)
  return params
}

function readSheet<T>(data: unknown, label: string, readRow: (row: Record<string, unknown>) => { ok: true; row: T | null } | { ok: false }): SheetPage<T> {
  if (!isRecord(data)) return { state: 'invalid', message: `${label}响应不是对象。` }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { state: 'invalid', message: `${label}响应的登录状态无效。` }
  if (!Object.prototype.hasOwnProperty.call(data, 'TableRows') || data.TableRows === null) {
    return { state: 'unknown', message: `${label}还没有对上页面上的列表结构，不能当成没有记录。` }
  }
  if (!Array.isArray(data.TableRows)) return { state: 'invalid', message: `${label}没有 TableRows。` }
  const rows: T[] = []
  for (const item of data.TableRows) {
    if (!isRecord(item)) return { state: 'invalid', message: `${label}有一行无法识别。` }
    const parsed = readRow(item)
    if (!parsed.ok) return { state: 'invalid', message: `${label}的文本字段不是字符串。` }
    if (parsed.row) rows.push(parsed.row)
  }
  const rawTotal = data.TableRowsCount
  const total = typeof rawTotal === 'string' && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null
  return { state: 'known', rows, total }
}

export function customerDemandParams(customerId: string, pageIndex: number): URLSearchParams | null {
  return sheetParams('GetCustomerDemand', customerId, pageIndex, 'demand_id', ';sn;case_type;demand_type;file_name;demand_name;demand_desc;update_user;create_user;update_time;create_time;is_disabled;demand_id;')
}

function demandRow(row: Record<string, unknown>): { ok: true; row: CustomerDemandRow | null } | { ok: false } {
  const caseType = cell(row, 'case_type')
  const demandType = cell(row, 'demand_type')
  const title = cell(row, 'demand_name')
  const description = cell(row, 'demand_desc')
  const fileName = cell(row, 'file_name')
  const disabled = cell(row, 'is_disabled')
  if (!caseType.ok || !demandType.ok || !title.ok || !description.ok || !fileName.ok || !disabled.ok) return { ok: false }
  const demandId = typeof row.demand_id === 'string' ? row.demand_id.slice(0, 80) : ''
  if (!demandId && !caseType.value && !demandType.value && !title.value && !description.value && !fileName.value) return { ok: true, row: null }
  return {
    ok: true,
    row: {
      demandId,
      caseType: caseType.value,
      demandType: demandType.value,
      title: title.value,
      description: decodeHtml(description.value),
      fileName: fileName.value,
      disabled: disabled.value === '1'
    }
  }
}

export function readCustomerDemandPage(data: unknown): SheetPage<CustomerDemandRow> {
  return readSheet(data, '客户要求', demandRow)
}

export function formatCustomerDemandText(rows: CustomerDemandRow[]): string {
  return rows.map((row, index) => {
    const lines = [
      `${index + 1}. 案件类型：${row.caseType}`,
      `要求类型：${row.demandType}`,
      `标题：${row.title}`,
      `描述：${row.description}`
    ]
    if (row.fileName) lines.push(`附件：${row.fileName}`)
    if (row.disabled) lines.push('状态：已停用')
    return lines.join('\n')
  }).join('\n\n')
}

export function customerDirectoryParams(customerId: string, pageIndex: number): URLSearchParams | null {
  const params = sheetParams('GetCustomerContact', customerId, pageIndex, 'contact_id', ';sn;case_type;contact_name;contact_type;tel;mobile;is_enabled;email;contact_address_cn;contact_id;')
  if (!params) return null
  params.set('order_by', '')
  return params
}

function directoryRow(row: Record<string, unknown>): { ok: true; row: CustomerDirectoryContact | null } | { ok: false } {
  const name = cell(row, 'contact_name')
  const email = cell(row, 'email')
  const contactType = cell(row, 'contact_type')
  if (!name.ok || !email.ok || !contactType.ok) return { ok: false }
  const contactId = typeof row.contact_id === 'string' ? row.contact_id.slice(0, 80) : ''
  if (!contactId && !name.value && !email.value && !contactType.value) return { ok: true, row: null }
  return { ok: true, row: { contactId, name: name.value, email: email.value, contactType: contactType.value } }
}

export function readCustomerDirectoryPage(data: unknown): SheetPage<CustomerDirectoryContact> {
  return readSheet(data, '客户联系人', directoryRow)
}

async function loadPages<T>(
  customerId: string,
  label: string,
  paramsFor: (customerId: string, pageIndex: number) => URLSearchParams | null,
  readPage: (data: unknown) => SheetPage<T>,
  post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
  signal?: AbortSignal
): Promise<ApiResult<{ rows: T[]; complete: boolean; message: string }>> {
  const rows: T[] = []
  let reportedTotal: number | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = paramsFor(customerId, page)
    if (!params) return apiError('INVALID_QUERY', `${label}需要原网站客户编号。`)
    const response = await post(params, signal)
    if (!response.ok) {
      if (rows.length === 0) return response
      return { ok: true, data: { rows, complete: false, message: '后面的页没有读完。' } }
    }
    const parsed = readPage(response.data)
    if (parsed.state !== 'known') {
      if (rows.length === 0) return apiError('INVALID_RESPONSE', parsed.message)
      return { ok: true, data: { rows, complete: false, message: parsed.message } }
    }
    rows.push(...parsed.rows)
    if (parsed.total !== null) reportedTotal = parsed.total
    const reached = reportedTotal !== null && rows.length >= reportedTotal
    if (reached || parsed.rows.length < PAGE_SIZE) return { ok: true, data: { rows, complete: true, message: '' } }
    if (parsed.total === null) return { ok: true, data: { rows, complete: false, message: `${label}没有总数，后面的页没有继续读。` } }
  }
  return { ok: true, data: { rows, complete: false, message: `${label}页数超过预留上限，记录不完整。` } }
}

export async function loadCustomerDemands(
  customerId: string,
  post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
  signal?: AbortSignal
): Promise<ApiResult<CustomerDemandAsset>> {
  const loaded = await loadPages(customerId, '客户要求', customerDemandParams, readCustomerDemandPage, post, signal)
  if (!loaded.ok) return loaded
  return {
    ok: true,
    data: {
      customerId,
      rows: loaded.data.rows,
      text: formatCustomerDemandText(loaded.data.rows),
      complete: loaded.data.complete,
      message: loaded.data.message
    }
  }
}

export async function loadCustomerDirectory(
  customerId: string,
  post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
  signal?: AbortSignal
): Promise<ApiResult<CustomerDirectoryAsset>> {
  const loaded = await loadPages(customerId, '客户联系人', customerDirectoryParams, readCustomerDirectoryPage, post, signal)
  if (!loaded.ok) return loaded
  return { ok: true, data: { customerId, rows: loaded.data.rows, complete: loaded.data.complete, message: loaded.data.message } }
}

function compact(value: string): string {
  return value.replace(/\s/g, '')
}

function oneEmail(contacts: CustomerDirectoryContact[], name: string): { status: 'one'; person: string; email: string } | { status: 'none' | 'many' } {
  const wanted = compact(name)
  if (!wanted) return { status: 'none' }
  const found = contacts.filter(item => compact(item.name) === wanted && item.email.includes('@') && !/[();；]/.test(item.email) && !/[();；]/.test(item.name))
  const emails = [...new Set(found.map(item => item.email.trim().toLowerCase()))]
  if (emails.length !== 1) return { status: emails.length === 0 ? 'none' : 'many' }
  const person = found.find(item => item.email.trim().toLowerCase() === emails[0])
  return person ? { status: 'one', person: person.name.trim(), email: person.email.trim() } : { status: 'none' }
}

/** 表格里还是称呼时，用客户资料页联系人补上唯一邮箱。对上多个就不选。 */
export function fillSheetEmails(
  rows: PctTaskRow[],
  contacts: CustomerDirectoryContact[],
  specials: ReadonlySet<string> = new Set(),
  mode: PctRecipientMode = 'ipr'
): { rows: PctTaskRow[]; notes: string[] } {
  const ambiguous: string[] = []
  let missed = 0
  const next = rows.map(row => {
    let mailTo = row.mailTo ?? ''
    let mailCc = row.mailCc ?? ''
    const apply = (name: string, current: string): string => {
      if (!name.trim() || current.includes('@')) return current
      const hit = oneEmail(contacts, name)
      if (hit.status === 'one') return appendRecipientField(current, `${hit.person}(${hit.email});`)
      if (hit.status === 'many') ambiguous.push(name.trim())
      else missed += 1
      return current
    }
    const names = sheetRecipientNames(row, specials, mode)
    mailTo = apply(names.to, mailTo)
    mailCc = apply(names.cc, mailCc)
    return {
      ...row,
      ...(mailTo ? { mailTo } : {}),
      ...(mailCc ? { mailCc } : {})
    }
  })
  const notes = [...new Set(ambiguous)].map(name => `「${name}」在客户联系人里对上了多个邮箱，没有选用。`)
  if (missed) notes.push(`${missed} 处称呼在客户联系人里没有对上邮箱。`)
  return { rows: next, notes }
}
