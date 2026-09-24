import { businessMessage, isRecord, readClientInfo, safeResponseKeys } from '../response-guards'
import { apiError, type ApiResult } from '../types'

export function readDictionaryBody(data: unknown): ApiResult<Record<string, unknown>> {
  if (!isRecord(data)) return apiError('INVALID_RESPONSE', '字典响应不是对象。')
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return client
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效，请在原网站重新登录。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  return { ok: true, data }
}

export function responseKeyNames(data: Record<string, unknown>): string[] {
  return safeResponseKeys(data)
}
