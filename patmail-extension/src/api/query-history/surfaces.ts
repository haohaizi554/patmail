/** SearchQueryHisList 按页面区分。期限监控的破折号是 U+2014，不是普通连字符。 */
export const HISTORY_SURFACES = ['file', 'limit'] as const
export type HistorySurface = (typeof HISTORY_SURFACES)[number]

export function isHistorySurface(value: unknown): value is HistorySurface {
  return value === 'file' || value === 'limit'
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
