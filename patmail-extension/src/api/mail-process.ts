import { isQueryGuid } from '../query/query-validator'
import { EASY_ORIGIN } from './config'
import { businessMessage, isRecord, readClientInfo } from './response-guards'
import { apiError, type ApiResult } from './types'

export type ProcessKind = 'AP' | 'EF' | 'CO'

export interface ProcessColumn {
  key: string
  label: string
}

export interface ProcessSpec {
  kind: ProcessKind
  label: string
  call: string
  colsel: string
  columns: ProcessColumn[]
}

export interface ProcessListQuery {
  kind: ProcessKind
  searchKey: string
  pageIndex: number
  pageSize: number
}

/** 原站 ProcessNew.js 打开一行时用的编号。发文只用 mail_id，不用列表里的 obj_id。 */
export interface ProcessOpenTarget {
  kind: ProcessKind
  id: string
  caseTypeId: string
  filingType: string
  title: string
}

export interface ProcessListRow {
  id: string
  cells: Record<string, string>
  open: ProcessOpenTarget | null
}

export interface ProcessListResult {
  kind: ProcessKind
  items: ProcessListRow[]
  total: number
  pageIndex: number
  pageSize: number
  totalPages: number
}

export interface MailProcessQuery {
  searchKey: string
  pageIndex: number
  pageSize: number
}

export interface MailProcessRow {
  mailId: string
  subject: string
  mailTo: string
  mailType: string
  customerName: string
  ownerName: string
  nodeName: string
  updatedAt: string
  remark: string
  urgency: string
}

export interface MailProcessResult {
  items: MailProcessRow[]
  total: number
  pageIndex: number
  pageSize: number
  totalPages: number
}

/** 列和 colsel 按 ProcessNew.aspx 三个页签的原站请求。提案列与待办表头一致。 */
export const PROCESS_SPECS: Record<ProcessKind, ProcessSpec> = {
  AP: {
    kind: 'AP',
    label: '提案流程',
    call: 'GetProcessByTypeAP',
    colsel: ';undefined;undefined;apply_name;tapp_no;tcase_volume;ctrl_proc;case_type_zh_cn;apply_type;business_type;customer_name;cn_name;create_time;node_name_zh_cn;update_time;now_remark;urgency_name;',
    columns: [
      { key: 'apply_name', label: '提案名称' },
      { key: 'tapp_no', label: '申请号' },
      { key: 'tcase_volume', label: '我方文号' },
      { key: 'ctrl_proc', label: '处理事项' },
      { key: 'case_type_zh_cn', label: '案件类型' },
      { key: 'apply_type', label: '申请类型' },
      { key: 'business_type', label: '业务类型' },
      { key: 'customer_name', label: '客户名称' },
      { key: 'cn_name', label: '创建人' },
      { key: 'create_time', label: '创建日期' },
      { key: 'node_name_zh_cn', label: '当前状态' },
      { key: 'update_time', label: '最后办理时间' },
      { key: 'now_remark', label: '当前流程备注' }
    ]
  },
  EF: {
    kind: 'EF',
    label: '递交流程',
    call: 'GetProcessByTypeEF',
    colsel: ';undefined;undefined;case_volume;app_no;case_name;case_type_zh_cn;customer_name;first_applicant_name;ctrl_proc_zh_cn;node_name_zh_cn;apply_type_zh_cn;int_due_date;cus_due_date;legal_due_date;proc_note;proc_status;update_time;now_remark;remark;case_status;filing_case_volume;related_case_volume;hearing_the_case;urgency_name;issue_no;',
    columns: [
      { key: 'case_volume', label: '我方文号' },
      { key: 'app_no', label: '申请号' },
      { key: 'case_name', label: '案件名称' },
      { key: 'case_type_zh_cn', label: '案件类型' },
      { key: 'customer_name', label: '客户名称' },
      { key: 'first_applicant_name', label: '第一申请人' },
      { key: 'ctrl_proc_zh_cn', label: '处理事项' },
      { key: 'node_name_zh_cn', label: '当前状态' },
      { key: 'apply_type_zh_cn', label: '申请类型' },
      { key: 'int_due_date', label: '内部期限' },
      { key: 'cus_due_date', label: '客户期限' },
      { key: 'legal_due_date', label: '官方期限' },
      { key: 'update_time', label: '最后办理时间' },
      { key: 'now_remark', label: '当前流程备注' },
      { key: 'case_status', label: '案件状态' }
    ]
  },
  CO: {
    kind: 'CO',
    label: '发文流程',
    call: 'GetProcessByTypeCO',
    colsel: ';undefined;undefined;mail_subject;mailtoname;mail_type_zh_cn;customer_name;cn_name;node_name_zh_cn;update_time;now_remark;urgency_name;',
    columns: [
      { key: 'customer_name', label: '客户' },
      { key: 'mail_subject', label: '主题' },
      { key: 'mail_type_zh_cn', label: '发文类型' },
      { key: 'mailtoname', label: '收件人' },
      { key: 'node_name_zh_cn', label: '节点' },
      { key: 'update_time', label: '更新时间' }
    ]
  }
}

export function isProcessKind(value: unknown): value is ProcessKind {
  return value === 'AP' || value === 'EF' || value === 'CO'
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function totalOf(response: Record<string, unknown>, itemCount: number): number | null {
  const raw = response.TableRowsCount
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw
  if (raw === undefined || raw === null || raw === '') return itemCount
  return null
}

export function buildProcessListParams(query: ProcessListQuery): ApiResult<URLSearchParams> {
  const spec = PROCESS_SPECS[query.kind]
  if (!spec) return apiError('INVALID_QUERY', '流程类型无效。')
  const searchKey = query.searchKey.trim()
  if (searchKey.length > 200) return apiError('INVALID_QUERY', '搜索词过长。')
  if (!Number.isSafeInteger(query.pageIndex) || query.pageIndex < 1) return apiError('INVALID_QUERY', '页码无效。')
  if (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) return apiError('INVALID_QUERY', '每页条数无效。')
  const params = new URLSearchParams()
  params.set('pageIndex', String(query.pageIndex))
  params.set('pageSize', String(query.pageSize))
  params.set('Call', spec.call)
  params.set('searchKey', searchKey)
  params.set('colsel', spec.colsel)
  params.set('_t', String(Date.now()))
  params.set('log_pagename', 'ProcessNew.aspx')
  return { ok: true, data: params }
}

export function buildMailProcessParams(query: MailProcessQuery): ApiResult<URLSearchParams> {
  return buildProcessListParams({ kind: 'CO', ...query })
}

/** Process.CaseType。提案按案件类型打开对应页面。 */
const APPLY_PAGES: Record<string, string> = {
  '31D1A147-2931-43B5-94AE-B72B1525BA8A': 'ApplyPatent.aspx',
  'ABD40742-04F9-455F-BC41-080E9D896F80': 'ApplyCopyRight.aspx',
  '0E8A4B7F-E407-4EFF-9562-3809BF484207': 'ApplyTradeMark.aspx',
  '122136EA-F3E3-46C5-A529-EFC358AC764B': 'ApplyOther.aspx',
  '882D9F78-7656-468E-BE98-68FE5E334A9B': 'TechService.aspx',
  '7A74BEB6-13DE-444B-892F-6E339D4067A2': 'LawCase.aspx',
  '849F2D30-DDAA-4718-AD1E-1951DE67913D': 'ApplyTort2.aspx'
}

const FILING_TYPES = new Set(['E', 'P', 'C', 'T', 'PCT', 'PCTOA', 'US'])

export function isProcessOpenTarget(value: unknown): value is ProcessOpenTarget {
  if (!isRecord(value) || !isProcessKind(value.kind)) return false
  if (Object.keys(value).length !== 5) return false
  if (typeof value.id !== 'string' || !isQueryGuid(value.id)) return false
  if (typeof value.caseTypeId !== 'string' || (value.caseTypeId !== '' && !isQueryGuid(value.caseTypeId))) return false
  if (typeof value.filingType !== 'string' || value.filingType.length > 20) return false
  if (typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 120) return false
  if (value.kind === 'AP') return value.filingType === '' && applyPageName(value.caseTypeId) !== null
  if (value.kind === 'CO') return value.caseTypeId === '' && value.filingType === ''
  return value.caseTypeId === '' && FILING_TYPES.has(value.filingType)
}

function applyPageName(caseTypeId: string): string | null {
  const page = APPLY_PAGES[caseTypeId.toUpperCase()]
  return page ?? null
}

export function filingNeedsCpcFlag(filingType: string): boolean {
  return filingType === 'E' || filingType === 'PCT' || filingType === 'PCTOA'
}

/** 与 Process.OpenFiling 的分支一致。guid 由首页 AddBusinessTab 自己追加。 */
export function processFormPath(target: ProcessOpenTarget, isNewCpc: boolean | null): string | null {
  if (target.kind === 'CO') return `Forms/mail/mail.aspx?objid=${target.id}`
  if (target.kind === 'AP') {
    const page = applyPageName(target.caseTypeId)
    if (!page) return null
    return `Forms/Patent/${page}?objid=${target.id}&type_id=${target.caseTypeId}`
  }
  if (filingNeedsCpcFlag(target.filingType) && isNewCpc === null) return null
  const next = isNewCpc === true
  if (target.filingType === 'E' && !next) return `Forms/Filing/Filing.aspx?objid=${target.id}`
  if (target.filingType === 'E' && next) return `Forms/NewFiling/Filing.aspx?objid=${target.id}`
  if (target.filingType === 'P') return `Forms/Filing/PaperFiling.aspx?objid=${target.id}`
  if (target.filingType === 'C') return `Forms/Filing/CopyFiling.aspx?objid=${target.id}`
  if (target.filingType === 'T') return `Forms/NewTradeFiling/TradeFiling.aspx?objid=${target.id}`
  if (target.filingType === 'PCT' && !next) return `Forms/Filing/FilingPCT.aspx?objid=${target.id}`
  if (target.filingType === 'PCT' && next) return `Forms/NewFiling/FilingPCT.aspx?objid=${target.id}`
  if (target.filingType === 'PCTOA' && !next) return `Forms/Filing/FilingPCTOA.aspx?objid=${target.id}`
  if (target.filingType === 'PCTOA' && next) return `Forms/NewFiling/FilingPCTOA.aspx?objid=${target.id}`
  if (target.filingType === 'US') return `Forms/Filing/FilingUS.aspx?objid=${target.id}`
  return null
}

function clipTitle(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim().slice(0, 80)
}

function openTarget(kind: ProcessKind, row: Record<string, unknown>): ProcessOpenTarget | null {
  if (kind === 'CO') {
    const id = text(row.mail_id)
    if (!isQueryGuid(id)) return null
    return { kind, id, caseTypeId: '', filingType: '', title: '发文' }
  }
  if (kind === 'AP') {
    const id = text(row.obj_id)
    const caseTypeId = text(row.case_type_id)
    if (!isQueryGuid(id) || !applyPageName(caseTypeId)) return null
    const name = clipTitle(text(row.apply_name))
    return { kind, id, caseTypeId, filingType: '', title: name ? `提案-${name}` : '提案' }
  }
  const id = text(row.filing_id)
  const filingType = text(row.filing_type)
  if (!isQueryGuid(id) || !FILING_TYPES.has(filingType)) return null
  const volume = clipTitle(text(row.case_volume))
  return { kind, id, caseTypeId: '', filingType, title: volume || '递交' }
}

/** 原站发文页。objid 是邮件编号。单独打开这个地址不会走首页页签，记录页不再使用。 */
export function mailPageUrl(origin: string, mailId: string, guid = globalThis.crypto.randomUUID()): string | null {
  if (origin !== EASY_ORIGIN || !isQueryGuid(mailId) || !isQueryGuid(guid)) return null
  const url = new URL('/Forms/mail/mail.aspx', origin)
  url.searchParams.set('objid', mailId)
  url.searchParams.set('guid', guid)
  return url.href
}

function readProcessRows(response: Record<string, unknown>, label: string): ApiResult<Array<Record<string, unknown>>> {
  if (response.TableRows === undefined) return apiError('INVALID_RESPONSE', `${label}没有返回 TableRows。`)
  if (response.TableRows !== null && !Array.isArray(response.TableRows)) {
    return apiError('INVALID_RESPONSE', 'TableRows 类型无效。')
  }
  const rows: Array<Record<string, unknown>> = []
  for (const row of response.TableRows ?? []) {
    if (!isRecord(row)) return apiError('INVALID_RESPONSE', `${label}不是对象。`)
    rows.push(row)
  }
  return { ok: true, data: rows }
}

/** 提案、递交、发文待办。空搜索是原站打开页签时的写法。没有 GUID 的行仍保留。 */
export function normalizeProcessList(response: unknown, query: ProcessListQuery): ApiResult<ProcessListResult> {
  const spec = PROCESS_SPECS[query.kind]
  if (!spec) return apiError('INVALID_QUERY', '流程类型无效。')
  if (!isRecord(response)) return apiError('INVALID_RESPONSE', `${spec.label}响应不是对象。`)
  const client = readClientInfo(response.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  if (client.data.Status !== true || client.data.IsLogin !== true) {
    return apiError('INVALID_RESPONSE', `${spec.label}缺少明确的登录状态。`)
  }
  const rows = readProcessRows(response, spec.label)
  if (!rows.ok) return rows
  const items: ProcessListRow[] = rows.data.map(row => {
    const open = openTarget(query.kind, row)
    const cells: Record<string, string> = {}
    for (const column of spec.columns) cells[column.key] = text(row[column.key])
    return { id: open?.id ?? '', cells, open }
  })
  const total = totalOf(response, items.length)
  if (total === null || !Number.isSafeInteger(total)) return apiError('INVALID_RESPONSE', 'TableRowsCount 不是有效非负整数。')
  return {
    ok: true,
    data: {
      kind: query.kind,
      items,
      total,
      pageIndex: query.pageIndex,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize)
    }
  }
}

/** 发文流程列表。空搜索是原站打开待办时的写法。没有邮件 GUID 的行仍保留，只是不能打开。 */
export function normalizeMailProcess(response: unknown, query: MailProcessQuery): ApiResult<MailProcessResult> {
  if (!isRecord(response)) return apiError('INVALID_RESPONSE', '发文列表响应不是对象。')
  const client = readClientInfo(response.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  if (client.data.Status !== true || client.data.IsLogin !== true) {
    return apiError('INVALID_RESPONSE', '发文列表缺少明确的登录状态。')
  }
  if (response.TableRows === undefined) return apiError('INVALID_RESPONSE', '发文列表没有返回 TableRows。')
  if (response.TableRows !== null && !Array.isArray(response.TableRows)) {
    return apiError('INVALID_RESPONSE', 'TableRows 类型无效。')
  }
  const items: MailProcessRow[] = []
  for (const row of response.TableRows ?? []) {
    if (!isRecord(row)) return apiError('INVALID_RESPONSE', '发文记录不是对象。')
    const rawId = text(row.obj_id) || text(row.mail_id) || text(row.objid)
    items.push({
      mailId: isQueryGuid(rawId) ? rawId : '',
      subject: text(row.mail_subject),
      mailTo: text(row.mailtoname),
      mailType: text(row.mail_type_zh_cn),
      customerName: text(row.customer_name),
      ownerName: text(row.cn_name),
      nodeName: text(row.node_name_zh_cn),
      updatedAt: text(row.update_time),
      remark: text(row.now_remark),
      urgency: text(row.urgency_name)
    })
  }
  const total = totalOf(response, items.length)
  if (total === null || !Number.isSafeInteger(total)) return apiError('INVALID_RESPONSE', 'TableRowsCount 不是有效非负整数。')
  return {
    ok: true,
    data: {
      items,
      total,
      pageIndex: query.pageIndex,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize)
    }
  }
}
