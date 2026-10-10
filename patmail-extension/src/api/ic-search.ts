import { CURRENT_ENVIRONMENT } from './config'
import { apiError, type ApiResult } from './types'
import { isRecord } from './response-guards'
import { isQueryGuid } from '../query/query-validator'
import { IC_SEARCH_COLSEL, IC_SEARCH_ELEMENT_FIELDS, IC_SEARCH_NULL_FIELDS } from './ic-search-fields'

export interface IcCaseHit {
  caseId: string
  caseVolume: string
  /** 列表列 case_volume_customer。按客户文号查时用来对上这一行。 */
  customerVolume?: string
}

/** 文号写进哪个查询栏。补查客户文号时不能再塞进我方文号。 */
export type IcSearchField = 'case_volume' | 'case_volume_customer'

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function tag(name: string, value = ''): string {
  return `&lt;${name}&gt;${xmlText(value)}&lt;/${name}&gt;`
}

/** 案件查询 ICSearchList。表单和期限监控一样先交空条件，但结束的事项也不会被这张表丢掉。多个文号用分号接在同一个栏里，最多 8 个。 */
export function buildIcSearchParams(
  caseVolume: string,
  now: () => number = Date.now,
  field: IcSearchField = 'case_volume',
  pageSize = 10
): ApiResult<URLSearchParams> {
  const parts = caseVolume.split(/[;；]/).map(item => item.trim()).filter(Boolean)
  if (!parts.length || parts.length > 8 || parts.some(part => part.length > 80) || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    return apiError('INVALID_QUERY', field === 'case_volume_customer' ? '客户文号无效。' : '我方文号无效。')
  }
  const volume = parts.join(';')
  const element = IC_SEARCH_ELEMENT_FIELDS.map(name => {
    if (name === field) return tag(name, volume)
    if (name === 'case_type') return tag(name, CURRENT_ENVIRONMENT.caseTypeId)
    if (IC_SEARCH_NULL_FIELDS.has(name)) return tag(name, 'null')
    return tag(name)
  }).join('')
  const params = new URLSearchParams()
  const pairs: Array<[string, string]> = [
    ['pageIndex', '1'],
    ['pageSize', String(pageSize)],
    ['Call', 'ICSearchList'],
    ['Element', element],
    ['is_proc', 'false'],
    ['is_fuzzy_query_app_no', 'false'],
    ['is_remove_symbol', 'false'],
    ['is_fuzzy_query_case_volume', 'false'],
    ['is_point_app_no', 'false'],
    ['is_first', 'true'],
    ['is_fuzzy_query_pct_app_no', 'false'],
    ['select_and', 'false'],
    ['is_top_volume_search', ''],
    ['colsel', IC_SEARCH_COLSEL],
    ['_t', String(now())],
    ['log_pagename', 'ICSearch.aspx']
  ]
  for (const [key, value] of pairs) params.append(key, value)
  return { ok: true, data: params }
}

export function icCasesFromBody(body: unknown): IcCaseHit[] {
  if (!isRecord(body) || !Array.isArray(body.TableRows)) return []
  const hits: IcCaseHit[] = []
  for (const row of body.TableRows) {
    if (!isRecord(row)) continue
    const caseId = typeof row.case_id === 'string' ? row.case_id.trim() : ''
    const caseVolume = typeof row.case_volume === 'string' ? row.case_volume.trim() : ''
    const customerVolume = typeof row.case_volume_customer === 'string' ? row.case_volume_customer.trim() : ''
    if (!isQueryGuid(caseId) || !caseVolume || caseVolume.length > 80) continue
    hits.push(customerVolume && customerVolume.length <= 80 ? { caseId, caseVolume, customerVolume } : { caseId, caseVolume })
  }
  return hits
}
