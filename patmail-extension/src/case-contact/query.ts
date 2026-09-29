import { isQueryGuid } from '../query/query-validator'
import { isRecord } from '../api/response-guards'

export interface CaseHit {
  volume: string
  caseId: string
}

export interface CaseContactRow {
  volume: string
  tech: string
  email: string
}

export interface CaseContactExport {
  rows: CaseContactRow[]
  unmatched: string[]
  failed: string[]
}

const SEARCH_FIELDS = [
  'case_volume_customer', 'app_no', 'case_name', 'case_type', 'apply_type', 'case_status',
  'country', 'business_type', 'apply_name'
] as const

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function tag(name: string, value = ''): string {
  return `&lt;${name}&gt;${xmlText(value)}&lt;/${name}&gt;`
}

/** 案件查询的 Element。值本身是转义后的 XML，交给表单编码再转一次。 */
export function agencySearchElement(volumes: string[]): string {
  return tag('case_volume', volumes.join('\n')) +
    SEARCH_FIELDS.map(name => tag(name)).join('') +
    tag('is_proc', '1') +
    tag('is_finish')
}

export function agencySearchParams(volumes: string[], pageUserId: string, pageIndex: number, pageSize: number): URLSearchParams {
  return new URLSearchParams({
    Call: 'AgencySearchCase',
    Element: agencySearchElement(volumes),
    is_proc: 'false',
    pageSize: String(pageSize),
    pageIndex: String(pageIndex),
    _PK: 'case_id',
    searchKey: '',
    log_pagename: 'CaseList.aspx',
    page_user_id: pageUserId
  })
}

export function patentDataParams(caseId: string): URLSearchParams {
  return new URLSearchParams({
    Call: 'GetPatentData',
    KeyColumn: 'case_id',
    Element: `&lt;p_case_info&gt;${tag('case_id', caseId)}${tag('tech_user_id')}${tag('case_volume')}&lt;/p_case_info&gt;`
  })
}

export function caseInfoParams(caseId: string): URLSearchParams {
  return new URLSearchParams({
    Call: 'GetCaseInfo',
    case_id: caseId,
    log_pagename: 'CaseInfo.aspx'
  })
}

function textOf(row: Record<string, unknown>, key: string, limit: number): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

export function searchHits(data: unknown): { hits: CaseHit[]; total: number } | null {
  if (!isRecord(data)) return null
  if (data.TableRows == null) return { hits: [], total: 0 }
  if (!Array.isArray(data.TableRows)) return null
  const hits: CaseHit[] = []
  for (const row of data.TableRows) {
    if (!isRecord(row)) continue
    const volume = textOf(row, 'case_volume', 80)
    const caseId = textOf(row, 'case_id', 40)
    if (!volume || !isQueryGuid(caseId)) continue
    hits.push({ volume, caseId })
  }
  const first = data.TableRows[0]
  const raw = isRecord(first) ? first.tablerowscount : hits.length
  const total = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : hits.length
  return { hits, total: Number.isFinite(total) ? total : hits.length }
}

/** 著录项目第一位发明人的邮箱。不读取身份证、手机和地址。 */
export function firstInventorEmail(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.Inventors) || !isRecord(data.Inventors[0])) return ''
  return textOf(data.Inventors[0], 'email', 200)
}

export function techUserText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.p_case_info) || !isRecord(data.p_case_info[0])) return ''
  return textOf(data.p_case_info[0], 'tech_user_id_text', 80)
}

export function shownVolume(data: unknown, fallback: string): string {
  if (!isRecord(data) || !Array.isArray(data.p_case_info) || !isRecord(data.p_case_info[0])) return fallback
  return textOf(data.p_case_info[0], 'case_volume', 80) || fallback
}
