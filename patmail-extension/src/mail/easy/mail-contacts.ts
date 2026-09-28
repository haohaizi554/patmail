import { isQueryGuid } from '../../query/query-validator'
import { isRecord, readClientInfo } from '../../api/response-guards'
import { apiError, type ApiResult } from '../../api/types'

const PAGE = 'mail.aspx'
const FIELD_LIMIT = 2_000

export type MailContactGroup = 'recent' | 'customer' | 'case' | 'sales' | 'pics' | 'agent'

export interface MailContactRow {
  group: MailContactGroup
  name: string
  email: string
  role: string
}

export interface MailIntroducer {
  name: string
  email: string
  insideName: string
  insideEmail: string
}

/** 发文页右侧联系人原文。complete 为假时，text 只含已经对上的分组。 */
export interface MailContactAsset {
  mailId: string
  customerId: string
  rows: MailContactRow[]
  introducer: MailIntroducer | null
  text: string
  complete: boolean
  message: string
}

export type MailContactOperation =
  | 'getRecentContact' | 'getCustomerContact' | 'getCaseContact'
  | 'getSalesContact' | 'getPicsContact' | 'getCaseAgentContact'

interface ContactSpec {
  group: MailContactGroup
  label: string
  operation: MailContactOperation
  call: string
  key: string
  nameKeys: string[]
  roleKey: string
  needs: 'none' | 'mail' | 'both'
}

const SPECS: ContactSpec[] = [
  { group: 'recent', label: '最近联系人', operation: 'getRecentContact', call: 'GetRecentContact', key: 'RecentContact', nameKeys: ['cn_name'], roleKey: '', needs: 'none' },
  { group: 'customer', label: '客户联系人', operation: 'getCustomerContact', call: 'GetCustomerContact', key: 'CustomerContact', nameKeys: ['contact_name'], roleKey: 'contact_type_zh_cn', needs: 'both' },
  { group: 'case', label: '案件联系人', operation: 'getCaseContact', call: 'GetCaseContact', key: 'CaseContact', nameKeys: ['contact_name'], roleKey: 'contact_type_zh_cn', needs: 'mail' },
  { group: 'sales', label: '业务联系人', operation: 'getSalesContact', call: 'GetSalesContact', key: 'SalesContact', nameKeys: ['cn_name'], roleKey: '', needs: 'mail' },
  { group: 'pics', label: 'IP联系人', operation: 'getPicsContact', call: 'GetPicsContact', key: 'PicsContact', nameKeys: ['cn_name'], roleKey: '', needs: 'mail' },
  { group: 'agent', label: '代理人', operation: 'getCaseAgentContact', call: 'GetCaseAgentContact', key: 'CaseAgentContact', nameKeys: ['cn_name', 'contact_name'], roleKey: '', needs: 'mail' }
]

export function mailContactParams(spec: ContactSpec, input: { mailId: string; customerId: string }): URLSearchParams | null {
  const params = new URLSearchParams()
  params.set('Call', spec.call)
  params.set('log_pagename', PAGE)
  if (spec.needs === 'none') return params
  if (!isQueryGuid(input.mailId)) return null
  params.set('mail_id', input.mailId)
  if (spec.needs === 'both') {
    if (!isQueryGuid(input.customerId)) return null
    params.set('customer_id', input.customerId)
  }
  return params
}

function textCell(row: Record<string, unknown>, key: string): { ok: true; value: string } | { ok: false } {
  if (!key || !Object.prototype.hasOwnProperty.call(row, key) || row[key] === null) return { ok: true, value: '' }
  if (typeof row[key] !== 'string') return { ok: false }
  return { ok: true, value: row[key].trim().slice(0, FIELD_LIMIT) }
}

/** 抓包里见过的数组为 null 时，这一组是空的。键不存在时不能当成没有联系人。 */
export function readMailContactGroup(data: unknown, spec: ContactSpec): { state: 'known'; rows: MailContactRow[]; introducer: MailIntroducer | null } | { state: 'unknown'; message: string } | { state: 'invalid'; message: string } {
  if (!isRecord(data)) return { state: 'invalid', message: `${spec.label}响应不是对象。` }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { state: 'invalid', message: `${spec.label}响应的登录状态无效。` }
  if (!Object.prototype.hasOwnProperty.call(data, spec.key)) {
    return { state: 'unknown', message: `${spec.label}没有对上已记录的字段，不能当成没有联系人。` }
  }
  const list = data[spec.key]
  if (list === null) return { state: 'known', rows: [], introducer: null }
  if (!Array.isArray(list)) return { state: 'invalid', message: `${spec.label}不是名单。` }
  const rows: MailContactRow[] = []
  for (const row of list) {
    if (!isRecord(row)) return { state: 'invalid', message: `${spec.label}有一行无法识别。` }
    let name = ''
    for (const key of spec.nameKeys) {
      const cell = textCell(row, key)
      if (!cell.ok) return { state: 'invalid', message: `${spec.label}的姓名不是字符串。` }
      if (cell.value) { name = cell.value; break }
    }
    const email = textCell(row, 'email')
    const role = textCell(row, spec.roleKey)
    if (!email.ok || !role.ok) return { state: 'invalid', message: `${spec.label}的邮箱或角色不是字符串。` }
    if (!name && !email.value) continue
    rows.push({ group: spec.group, name, email: email.value, role: role.value })
  }
  return { state: 'known', rows, introducer: spec.group === 'customer' ? readIntroducer(data.Introducer) : null }
}

function readIntroducer(value: unknown): MailIntroducer | null {
  if (!isRecord(value)) return null
  const cell = (key: string) => typeof value[key] === 'string' ? value[key].trim().slice(0, FIELD_LIMIT) : ''
  const introducer = { name: cell('introducer'), email: cell('introducer_email'), insideName: cell('inside_introducer'), insideEmail: cell('inside_introducer_email') }
  return introducer.name || introducer.email || introducer.insideName || introducer.insideEmail ? introducer : null
}

export function formatMailContactText(rows: MailContactRow[], introducer: MailIntroducer | null): string {
  const blocks: string[] = []
  for (const spec of SPECS) {
    const groupRows = rows.filter(row => row.group === spec.group)
    if (groupRows.length === 0) continue
    const lines = groupRows.map(row => {
      const who = row.email ? `${row.name} <${row.email}>` : row.name
      return row.role ? `${who}（${row.role}）` : who
    })
    blocks.push([spec.label, ...lines].join('\n'))
  }
  if (introducer) {
    const lines = ['介绍人']
    if (introducer.name || introducer.email) lines.push(`外部：${introducer.email ? `${introducer.name} <${introducer.email}>` : introducer.name}`)
    if (introducer.insideName || introducer.insideEmail) lines.push(`内部：${introducer.insideEmail ? `${introducer.insideName} <${introducer.insideEmail}>` : introducer.insideName}`)
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

export async function loadMailContactText(
  input: { mailId: string; customerId: string },
  post: (operation: MailContactOperation, params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
  signal?: AbortSignal
): Promise<ApiResult<MailContactAsset>> {
  const rows: MailContactRow[] = []
  const notes: string[] = []
  let introducer: MailIntroducer | null = null
  let complete = true
  if (!isQueryGuid(input.mailId)) {
    complete = false
    notes.push('没有发文编号，客户联系人、案件联系人、业务联系人、IP 联系人和代理人没有读取。')
  } else if (!isQueryGuid(input.customerId)) {
    complete = false
    notes.push('没有客户编号，客户联系人没有读取。')
  }
  const jobs = SPECS.filter(spec => mailContactParams(spec, input))
  const loaded = await Promise.all(jobs.map(async spec => {
    const params = mailContactParams(spec, input)
    if (!params) return { spec, result: apiError('INVALID_QUERY', `${spec.label}缺少编号。`) }
    return { spec, result: await post(spec.operation, params, signal) }
  }))
  for (const { spec, result } of loaded) {
    if (!result.ok) {
      complete = false
      notes.push(result.error.message)
      continue
    }
    const parsed = readMailContactGroup(result.data, spec)
    if (parsed.state !== 'known') {
      complete = false
      notes.push(parsed.message)
      continue
    }
    rows.push(...parsed.rows)
    if (parsed.introducer) introducer = parsed.introducer
  }
  return {
    ok: true,
    data: {
      mailId: input.mailId,
      customerId: input.customerId,
      rows,
      introducer,
      text: formatMailContactText(rows, introducer),
      complete,
      message: notes.join(' ').slice(0, 400)
    }
  }
}

export function contactSpec(group: MailContactGroup): ContactSpec {
  const spec = SPECS.find(item => item.group === group)
  if (!spec) throw new Error('未知联系人分组。')
  return spec
}
