import { describe, expect, it } from 'vitest'
import { EasyTransport } from '../src/api/transport'
import { SessionService } from '../src/api/session'

function sessionWith(body: string, status = 200, url = ''): SessionService {
  const fetcher: typeof fetch = async () => {
    const response = new Response(body, { status, headers: { 'content-type': 'text/plain' } })
    if (url) Object.defineProperty(response, 'url', { value: url })
    return response
  }
  return new SessionService(new EasyTransport('http://183.36.43.66:88', { fetcher }))
}

describe('GetUserModel 会话判断', () => {
  it('accepts explicit ClientInfo.IsLogin=true without inventing user fields', async () => {
    const session = sessionWith(JSON.stringify({ ClientInfo: { IsLogin: true, Status: true, Result: true }, Model: { unknown_name: '不应展示' } }))
    const result = await session.check()
    expect(result).toMatchObject({ ok: true, data: { status: 'authenticated' } })
    if (!result.ok) return
    expect(result.data.displayName).toBeUndefined()
    expect(result.data.userId).toBeUndefined()
    expect(Number.isNaN(Date.parse(result.data.checkedAt))).toBe(false)
    expect(session.status).toBe('authenticated')
  })

  it('separates first-time unauthenticated from expiration after authentication', async () => {
    let current = { ClientInfo: { IsLogin: false } }
    const fetcher: typeof fetch = async () => new Response(JSON.stringify(current))
    const session = new SessionService(new EasyTransport('http://183.36.43.66:88', { fetcher }))
    expect(await session.check()).toMatchObject({ ok: true, data: { status: 'unauthenticated' } })
    current = { ClientInfo: { IsLogin: true } }
    expect(await session.check()).toMatchObject({ ok: true, data: { status: 'authenticated' } })
    current = { ClientInfo: { IsLogin: false } }
    expect(await session.check()).toMatchObject({ ok: true, data: { status: 'expired' } })
  })

  it('reports unknown structure and safe key-only diagnostics', async () => {
    const session = sessionWith(JSON.stringify({ model: { secret_value: 'must-not-leak' }, marker: 'x' }))
    const result = await session.check()
    expect(result).toMatchObject({ ok: false, error: { code: 'AUTH_UNKNOWN', responseKeys: ['model', 'marker'] } })
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(session.status).toBe('error')
  })

  it('does not turn business failure, HTTP 502 or malformed ClientInfo into a logged-out claim', async () => {
    const business = await sessionWith(JSON.stringify({ ClientInfo: { IsLogin: true, Status: false, Message: '失败' } })).check()
    expect(business).toMatchObject({ ok: false, error: { code: 'BUSINESS_ERROR' } })
    const gateway = sessionWith('gateway down', 502)
    expect(await gateway.check()).toMatchObject({ ok: false, error: { code: 'HTTP_ERROR', status: 502 } })
    expect(gateway.status).toBe('error')
    const malformed = await sessionWith(JSON.stringify({ ClientInfo: { IsLogin: 'yes' } })).check()
    expect(malformed).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } })
  })

  it('classifies login-page redirect as session loss', async () => {
    const session = sessionWith('<html><form action="/Login.aspx"></form></html>', 200, 'http://183.36.43.66:88/Login.aspx')
    const result = await session.check()
    expect(result).toMatchObject({ ok: true, data: { status: 'unauthenticated' } })
    expect(session.status).toBe('unauthenticated')
  })

  it('shows first-time HTTP 401 as unauthenticated, but a later 401 as expired', async () => {
    let failed = true
    const fetcher: typeof fetch = async () => failed
      ? new Response('unauthorized', { status: 401 })
      : new Response(JSON.stringify({ ClientInfo: { IsLogin: true } }))
    const session = new SessionService(new EasyTransport('http://183.36.43.66:88', { fetcher }))
    expect(await session.check()).toMatchObject({ ok: true, data: { status: 'unauthenticated' } })
    failed = false
    expect(await session.check()).toMatchObject({ ok: true, data: { status: 'authenticated' } })
    failed = true
    expect(await session.check()).toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } })
    expect(session.status).toBe('expired')
  })
})
