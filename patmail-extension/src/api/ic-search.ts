import { CURRENT_ENVIRONMENT } from './config'
import { apiError, type ApiResult } from './types'
import { isRecord } from './response-guards'
import { isQueryGuid } from '../query/query-validator'
import { IC_SEARCH_COLSEL, IC_SEARCH_ELEMENT_FIELDS, IC_SEARCH_NULL_FIELDS } from './ic-search-fields'

export interface IcCaseHit {
  caseId: string
  caseVolume: string
}

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function tag(name: string, value = ''): string {
  return `&lt;${name}&gt;${xmlText(value)}&lt;/${name}&gt;`
}

/** 案件查询 ICSearchList。表单和期限监控一样先交空条件，但结束的事项也不会被这张表丢掉。 */
export function buildIcSearchParams(caseVolume: string, now: () => number = Date.now): ApiResult<URLSearchParams> {
  const volume = caseVolume.trim()
  if (!volume || volume.length > 80) return apiError('INVALID_QUERY', '我方文号无效。')
  const element = IC_SEARCH_ELEMENT_FIELDS.map(name => {
    if (name === 'case_volume') return tag(name, volume)
    if (name === 'case_type') return tag(name, CURRENT_ENVIRONMENT.caseTypeId)
    if (IC_SEARCH_NULL_FIELDS.has(name)) return tag(name, 'null')
    return tag(name)
  }).join('')
  const params = new URLSearchParams()
  const pairs: Array<[string, string]> = [
    ['pageIndex', '1'],
    ['pageSize', '10'],
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
    if (!isQueryGuid(caseId) || !caseVolume || caseVolume.length > 80) continue
    hits.push({ caseId, caseVolume })
  }
  return hits
}
