import { businessMessage, isRecord, readClientInfo, safeResponseKeys } from '../response-guards'
import { apiError, type ApiResult } from '../types'
import { isHistoryOption } from './guards'
import type { HistoryQueryOption } from './types'

function authFailure(data: Record<string, unknown>): ApiResult<never> | null {
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效，请在原网站重新登录。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  return null
}

export function normalizeHistoryOptions(data: unknown): ApiResult<HistoryQueryOption[]> {
  if (!isRecord(data)) return apiError('INVALID_RESPONSE', '历史模板响应不是对象。', undefined)
  const auth = authFailure(data)
  if (auth) return auth
  if (data.Options === null) return { ok: true, data: [] }
  if (data.Options === undefined) {
    return { ok: false, error: {
      code: 'INVALID_RESPONSE', message: '历史模板响应缺少 Options。', responseKeys: safeResponseKeys(data)
    } }
  }
  if (!Array.isArray(data.Options)) {
    return apiError('INVALID_RESPONSE', '历史模板 Options 结构无效。')
  }
  const options: HistoryQueryOption[] = []
  for (const item of data.Options) {
    if (!isHistoryOption(item)) return apiError('INVALID_RESPONSE', '历史模板选项缺少 query_id 或 title。')
    options.push({ id: item.query_id, name: item.title.trim(), source: 'easy' })
  }
  return { ok: true, data: options }
}

export function normalizeHistoryDetail(data: unknown, queryId: string): ApiResult<{ id: string; queryXml: string; name?: string }> {
  if (!isRecord(data)) return apiError('INVALID_RESPONSE', '历史模板详情不是对象。')
  const auth = authFailure(data)
  if (auth) return auth
  let name: string | undefined
  if (data.Options !== undefined && data.Options !== null) {
    const listed = normalizeHistoryOptions(data)
    if (!listed.ok) return listed
    name = listed.data.find(item => item.id === queryId)?.name
  }
  if (!Array.isArray(data.QueryXml) || data.QueryXml.length === 0) {
    return apiError('INVALID_QUERY', '未找到该历史模板。')
  }
  const row = data.QueryXml[0]
  if (!isRecord(row) || typeof row.query_xml !== 'string' || !row.query_xml.trim()) {
    return apiError('INVALID_QUERY', '未找到该历史模板。')
  }
  return { ok: true, data: { id: queryId, ...(name ? { name } : {}), queryXml: row.query_xml } }
}
