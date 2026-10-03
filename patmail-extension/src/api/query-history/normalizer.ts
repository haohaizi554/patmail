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

/**
 * 这套原网站写入和删除成功时，ClientInfo.Result 经常仍是 false、Message 为空。
 * 真正的成败在顶层 Ret。没有 Ret 时，只有带文字的 Message 或 Status=false 才算没写上。
 * 响应里没有新模板 ID，调用方保存后要重新读列表。
 */
export function normalizeHistorySave(data: unknown): ApiResult<{ saved: true }> {
  if (!isRecord(data)) return apiError('INVALID_RESPONSE', '保存查询模板的响应不是对象。')
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效，请在原网站重新登录。')
  if (data.Ret === false || client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  if (data.Ret === true) return { ok: true, data: { saved: true } }
  if (client.data.Result === false && typeof client.data.Message === 'string' && client.data.Message.trim()) {
    return apiError('BUSINESS_ERROR', businessMessage(client.data))
  }
  if (client.data.Result === true || client.data.Status === true) return { ok: true, data: { saved: true } }
  return apiError('INVALID_RESPONSE', '保存查询模板的响应没有成功标记。', undefined)
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
