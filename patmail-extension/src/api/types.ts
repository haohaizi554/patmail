/** 业务失败码保留失败阶段，UI 不需要接触原始响应。 */
export type ApiErrorCode =
  | 'INVALID_ORIGIN' | 'INVALID_QUERY' | 'NETWORK_ERROR' | 'REQUEST_TIMEOUT'
  | 'HTTP_ERROR' | 'SESSION_EXPIRED' | 'AUTH_UNKNOWN' | 'BUSINESS_ERROR'
  | 'INVALID_RESPONSE' | 'UNEXPECTED_HTML' | 'REQUEST_ABORTED'

export interface ApiError {
  code: ApiErrorCode
  message: string
  status?: number
  /** 只包含字段名，不包含 Cookie、请求参数或原始响应值。 */
  responseKeys?: string[]
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export function apiError(code: ApiErrorCode, message: string, status?: number): ApiResult<never> {
  return { ok: false, error: { code, message, ...(status === undefined ? {} : { status }) } }
}
