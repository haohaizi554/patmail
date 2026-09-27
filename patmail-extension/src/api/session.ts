import { businessMessage, isRecord, readClientInfo, safeResponseKeys } from './response-guards'
import { apiError, type ApiResult } from './types'
import type { EasyTransport } from './transport'

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 只提取已在现场响应中确认的展示字段，不保留 SessionId、菜单或完整用户模型。 */
function sessionIdentity(data: Record<string, unknown>): Pick<SessionSummary, 'displayName' | 'userId'> {
  if (!isRecord(data.UserModel)) return {}
  const model = data.UserModel
  const name = typeof model.Name === 'string' ? model.Name.trim() : ''
  const account = typeof model.user_name === 'string' ? model.user_name.trim() : ''
  const userId = typeof model.user_id === 'string' && USER_ID.test(model.user_id.trim()) ? model.user_id.trim() : ''
  return {
    ...(name || account ? { displayName: (name || account).slice(0, 80) } : {}),
    ...(userId ? { userId } : {})
  }
}

export type SessionStatus =
  | 'unknown' | 'checking' | 'authenticated' | 'unauthenticated' | 'expired' | 'error'

export interface SessionSummary {
  status: SessionStatus
  displayName?: string
  userId?: string
  checkedAt: string
  message?: string
}

export class SessionService {
  status: SessionStatus = 'unknown'
  private wasAuthenticated = false
  private generation = 0

  constructor(private readonly transport: EasyTransport) {}

  clear(): void {
    this.generation++
    this.status = 'unknown'
    this.wasAuthenticated = false
  }

  expire(): void {
    this.generation++
    this.status = 'expired'
  }

  async check(signal?: AbortSignal): Promise<ApiResult<SessionSummary>> {
    const current = ++this.generation
    // 已经登录时，后台复查不能把状态改成“检测中”，否则并行的模板请求会当成未登录。
    if (this.status !== 'authenticated') this.status = 'checking'
    const response = await this.transport.post('session', new URLSearchParams({
      Call: 'GetUserModel', log_pagename: ''
    }), signal)
    if (current !== this.generation || signal?.aborted) {
      return apiError('REQUEST_ABORTED', '请求已取消。')
    }
    if (!response.ok) {
      this.status = response.error.code === 'SESSION_EXPIRED'
        ? this.wasAuthenticated ? 'expired' : 'unauthenticated' : 'error'
      if (response.error.code === 'SESSION_EXPIRED') {
        if (!this.wasAuthenticated) {
          return { ok: true, data: { status: 'unauthenticated', checkedAt: new Date().toISOString() } }
        }
      }
      return response
    }
    if (!isRecord(response.data)) {
      this.status = 'error'
      return apiError('INVALID_RESPONSE', 'GetUserModel 响应不是对象。')
    }
    const client = readClientInfo(response.data.ClientInfo)
    if (!client.ok) {
      this.status = 'error'
      if (response.data.ClientInfo === undefined) {
        return { ok: false, error: {
          code: 'AUTH_UNKNOWN', message: '无法确认当前登录状态。',
          responseKeys: safeResponseKeys(response.data)
        } }
      }
      return client
    }
    const info = client.data
    if (info.IsLogin === false) {
      this.status = this.wasAuthenticated ? 'expired' : 'unauthenticated'
      return { ok: true, data: { status: this.status, checkedAt: new Date().toISOString() } }
    }
    if (info.Status === false) {
      this.status = 'error'
      return apiError('BUSINESS_ERROR', businessMessage(info))
    }
    // 现场 GetUserModel 在已登录时 Result 仍为 false，不能把它当成登录失败。
    if (info.IsLogin !== true) {
      this.status = 'error'
      return { ok: false, error: {
        code: 'AUTH_UNKNOWN', message: '无法确认当前登录状态。',
        responseKeys: safeResponseKeys(response.data)
      } }
    }
    this.status = 'authenticated'
    this.wasAuthenticated = true
    return { ok: true, data: {
      status: 'authenticated', checkedAt: new Date().toISOString(), ...sessionIdentity(response.data)
    } }
  }
}
