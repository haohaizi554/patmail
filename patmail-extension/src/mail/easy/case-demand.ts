import { isQueryGuid } from '../../query/query-validator'
import { isRecord, readClientInfo } from '../../api/response-guards'
import { apiError, type ApiResult } from '../../api/types'

const PAGE = 'mail.aspx'
const PAGE_SIZE = 10
const MAX_PAGES = 20
const FIELD_LIMIT = 20_000

/** 发文页要求表的一行原文。编号只用来对齐，不参与后来的判断。 */
export interface CaseDemandRow {
  demandId: string
  demandType: string
  title: string
  description: string
}

/** 一次案件的要求表文本。complete 为假时，text 只覆盖已经读到的页。 */
export interface CaseDemandAsset {
  caseId: string
  rows: CaseDemandRow[]
  text: string
  complete: boolean
  message: string
}

export function caseDemandParams(caseId: string, pageIndex: number): URLSearchParams | null {
  if (!isQueryGuid(caseId) || !Number.isInteger(pageIndex) || pageIndex < 1) return null
  const params = new URLSearchParams()
  params.set('Call', 'GetDemandBuCaseid')
  params.set('case_id', caseId)
  params.set('pageIndex', String(pageIndex))
  params.set('pageSize', String(PAGE_SIZE))
  params.set('searchKey', '')
  params.set('_PK', 'demand_id')
  params.set('colsel', ';demand_type;demand_name;demand_desc;')
  params.set('log_pagename', PAGE)
  return params
}

function cell(row: Record<string, unknown>, key: string): { ok: true; value: string } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === null) return { ok: true, value: '' }
  if (typeof row[key] !== 'string') return { ok: false }
  return { ok: true, value: row[key].slice(0, FIELD_LIMIT) }
}

/** 与同页 GetMailCase 一样认 TableRows。正文还没跟页面核对，对不上就不当成空表。 */
export function readCaseDemandPage(data: unknown): { state: 'known'; rows: CaseDemandRow[]; total: number | null } | { state: 'unknown'; message: string } | { state: 'invalid'; message: string } {
  if (!isRecord(data)) return { state: 'invalid', message: '要求表响应不是对象。' }
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { state: 'invalid', message: '要求表响应的登录状态无效。' }
  if (!Object.prototype.hasOwnProperty.call(data, 'TableRows') || data.TableRows === null) {
    return { state: 'unknown', message: '要求表还没有对上页面上的列表结构，不能当成没有要求。' }
  }
  if (!Array.isArray(data.TableRows)) return { state: 'invalid', message: '要求表没有 TableRows。' }
  const rows: CaseDemandRow[] = []
  for (const row of data.TableRows) {
    if (!isRecord(row)) return { state: 'invalid', message: '要求表有一行无法识别。' }
    const demandType = cell(row, 'demand_type')
    const title = cell(row, 'demand_name')
    const description = cell(row, 'demand_desc')
    if (!demandType.ok || !title.ok || !description.ok) return { state: 'invalid', message: '要求表的文本字段不是字符串。' }
    const demandId = typeof row.demand_id === 'string' ? row.demand_id.slice(0, 80) : ''
    if (!demandId && !demandType.value && !title.value && !description.value) continue
    rows.push({ demandId, demandType: demandType.value, title: title.value, description: description.value })
  }
  const rawTotal = data.TableRowsCount
  const total = typeof rawTotal === 'string' && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null
  return { state: 'known', rows, total }
}

/** 按页面列序拼成纯文本。空列留空，不改写人写的原句。 */
export function formatCaseDemandText(rows: CaseDemandRow[]): string {
  return rows.map((row, index) => [
    `${index + 1}. 要求类型：${row.demandType}`,
    `标题：${row.title}`,
    `描述：${row.description}`
  ].join('\n')).join('\n\n')
}

export async function loadCaseDemandText(
  caseId: string,
  post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
  signal?: AbortSignal
): Promise<ApiResult<CaseDemandAsset>> {
  const rows: CaseDemandRow[] = []
  let reportedTotal: number | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = caseDemandParams(caseId, page)
    if (!params) return apiError('INVALID_QUERY', '要求表需要案件编号。')
    const response = await post(params, signal)
    if (!response.ok) {
      if (rows.length === 0) return response
      return { ok: true, data: asset(caseId, rows, false, '后面的页没有读完。') }
    }
    const parsed = readCaseDemandPage(response.data)
    if (parsed.state !== 'known') {
      if (rows.length === 0) return apiError('INVALID_RESPONSE', parsed.message)
      return { ok: true, data: asset(caseId, rows, false, parsed.message) }
    }
    rows.push(...parsed.rows)
    if (parsed.total !== null) reportedTotal = parsed.total
    const reached = reportedTotal !== null && rows.length >= reportedTotal
    if (reached || parsed.rows.length < PAGE_SIZE) return { ok: true, data: asset(caseId, rows, true, '') }
    if (parsed.total === null) return { ok: true, data: asset(caseId, rows, false, '要求表没有总数，后面的页没有继续读。') }
  }
  return { ok: true, data: asset(caseId, rows, false, '要求表页数超过预留上限，文本不完整。') }
}

function asset(caseId: string, rows: CaseDemandRow[], complete: boolean, message: string): CaseDemandAsset {
  return { caseId, rows, text: formatCaseDemandText(rows), complete, message }
}
