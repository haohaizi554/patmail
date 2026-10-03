/** SearchQueryHisList 按页面区分。期限监控的破折号是 U+2014，不是普通连字符。 */
export const HISTORY_SURFACES = ['file', 'limit'] as const
export type HistorySurface = (typeof HISTORY_SURFACES)[number]

export function isHistorySurface(value: unknown): value is HistorySurface {
  return value === 'file' || value === 'limit'
}

export function historySaveRequest(surface: HistorySurface, title: string, queryId: string, queryXml: string): URLSearchParams {
  const limit = surface === 'limit'
  return new URLSearchParams({
    Call: 'SearchQueryHisSave',
    is_proc: 'false',
    is_out_save: 'false',
    is_query_save: 'true',
    query_save_title: title,
    query_id: queryId,
    query_xml: queryXml,
    out_xml: '',
    query_type: limit ? 'LimitMonitor\u2014liall' : 'FileSearch'
  })
}

export function historyDeleteRequest(surface: HistorySurface, queryId: string): URLSearchParams {
  const limit = surface === 'limit'
  return new URLSearchParams({
    Call: 'SearchQueryHisDelete',
    query_id: queryId,
    log_pagename: limit ? 'LimitMonitor.aspx' : 'FileSearch.aspx'
  })
}

export function historyRequest(surface: HistorySurface, queryId: string): URLSearchParams {
  const limit = surface === 'limit'
  return new URLSearchParams({
    Call: 'SearchQueryHisList',
    query_type: limit ? 'LimitMonitor\u2014liall' : 'FileSearch',
    query_id: queryId,
    log_pagename: limit ? 'LimitMonitor.aspx' : 'FileSearch.aspx'
  })
}
