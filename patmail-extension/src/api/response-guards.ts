import { apiError, type ApiResult } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export interface EasyClientInfo {
  IsLogin?: boolean
  Status?: boolean
  Result?: boolean
  Message?: string | null
  Url?: string | null
}

/** 只验证已经记录的公共字段；缺失与 true 是不同状态。 */
export function readClientInfo(value: unknown): ApiResult<EasyClientInfo> {
  if (!isRecord(value)) return apiError('INVALID_RESPONSE', 'EASY 响应缺少 ClientInfo。')
  for (const key of ['IsLogin', 'Status', 'Result'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      return apiError('INVALID_RESPONSE', `ClientInfo.${key} 类型无效。`)
    }
  }
  for (const key of ['Message', 'Url'] as const) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') {
      return apiError('INVALID_RESPONSE', `ClientInfo.${key} 类型无效。`)
    }
  }
  return { ok: true, data: value as EasyClientInfo }
}

export function safeResponseKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).slice(0, 20).map(key => {
    if (/token|password|secret|cookie|credential|authorization/i.test(key)) return '[REDACTED]'
    return key.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)
  })
}

export function businessMessage(info: EasyClientInfo): string {
  return typeof info.Message === 'string' && info.Message.trim()
    ? info.Message.trim().slice(0, 200) : 'EASY 返回业务失败。'
}
