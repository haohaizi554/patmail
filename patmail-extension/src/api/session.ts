import { businessMessage, isRecord, readClientInfo, safeResponseKeys } from './response-guards'
import { apiError, type ApiResult } from './types'
import type { EasyTransport } from './transport'

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
  private rawUserModel: unknown = null
  private generation = 0

  constructor(private readonly transport: EasyTransport) {}

  clear(): void {
    this.generation++
    this.status = 'unknown'
    this.wasAuthenticated = false
    this.rawUserModel = null
  }

  expire(): void {
    this.generation++
    this.status = 'expired'
    this.rawUserModel = null
  }

  async check(signal?: AbortSignal): Promise<ApiResult<SessionSummary>> {
    const current = ++this.generation
    this.status = 'checking'
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
        this.rawUserModel = null
        if (!this.wasAuthenticated) {
          return { ok: true, data: { status: 'unauthenticated', checkedAt: new Date().toISOString() } }
        }
      }
      return response
    }
    this.rawUserModel = response.data
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
      this.rawUserModel = null
      return { ok: true, data: { status: this.status, checkedAt: new Date().toISOString() } }
    }
    if (info.Status === false || info.Result === false) {
      this.status = 'error'
      return apiError('BUSINESS_ERROR', businessMessage(info))
    }
    if (info.IsLogin !== true) {
      this.status = 'error'
      return { ok: false, error: {
        code: 'AUTH_UNKNOWN', message: '无法确认当前登录状态。',
        responseKeys: safeResponseKeys(response.data)
      } }
    }
    this.status = 'authenticated'
    this.wasAuthenticated = true
    // GetUserModel 的姓名/ID 字段尚未确认，摘要不编造这些值。
    return { ok: true, data: { status: 'authenticated', checkedAt: new Date().toISOString() } }
  }
}
