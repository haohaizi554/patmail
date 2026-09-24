import { describe, expect, it, vi } from 'vitest'
import { EasyTransport } from '../src/api/transport'

function jsonResponse(body: unknown, status = 200, url = 'http://183.36.43.66:88/AjaxServers/Login.ashx'): Response {
  const response = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

const sessionParams = () => new URLSearchParams({ Call: 'GetUserModel', log_pagename: '' })

describe('EASY 受限传输', () => {
  it('binds the browser fetch receiver when using the native global function', async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(jsonResponse({ ClientInfo: { IsLogin: true } }))
    })
    vi.stubGlobal('fetch', nativeLikeFetch)
    try {
      const result = await new EasyTransport('http://183.36.43.66:88').post('session', sessionParams())
      expect(result.ok).toBe(true)
      expect(nativeLikeFetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('posts form-urlencoded on the trusted same origin with browser-managed credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return jsonResponse({ ClientInfo: { IsLogin: true, Status: true } })
    }
    const transport = new EasyTransport('http://183.36.43.66:88', { fetcher })
    const result = await transport.post('session', sessionParams())
    expect(result).toMatchObject({ ok: true, data: { ClientInfo: { IsLogin: true } } })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://183.36.43.66:88/AjaxServers/Login.ashx')
    expect(calls[0].init).toMatchObject({
      method: 'POST', credentials: 'same-origin', redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }
    })
    expect(new URLSearchParams(String(calls[0].init.body)).get('log_pagename')).toBe('')
  })

  it('refuses unrelated origins and unapproved Call values before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const outside = new EasyTransport('https://untrusted.example', { fetcher })
    expect(await outside.post('session', sessionParams())).toMatchObject({ ok: false, error: { code: 'INVALID_ORIGIN' } })
    const trusted = new EasyTransport('http://183.36.43.66:88', { fetcher })
    expect(await trusted.post('session', new URLSearchParams({ Call: 'MailCustomer' })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_QUERY' } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not trust an arbitrary localhost app as an EASY API origin', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const local = new EasyTransport('http://127.0.0.1:7777', { fetcher })
    expect(await local.post('session', sessionParams()))
      .toMatchObject({ ok: false, error: { code: 'INVALID_ORIGIN' } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps network, HTTP, login HTML and invalid JSON failures distinct', async () => {
    const cases: Array<{ response?: Response; fail?: Error; code: string; status?: number }> = [
      { fail: new TypeError('offline'), code: 'NETWORK_ERROR' },
      { response: new Response('gateway down', { status: 502 }), code: 'HTTP_ERROR', status: 502 },
      { response: new Response('unavailable', { status: 503 }), code: 'HTTP_ERROR', status: 503 },
      { response: new Response('<html><form action="/Login.aspx"></form></html>'), code: 'SESSION_EXPIRED' },
      { response: new Response('<html><body>proxy error</body></html>'), code: 'UNEXPECTED_HTML' },
      { response: new Response('{not json'), code: 'INVALID_RESPONSE' }
    ]
    for (const item of cases) {
      const fetcher: typeof fetch = async () => {
        if (item.fail) throw item.fail
        return item.response!
      }
      const result = await new EasyTransport('http://183.36.43.66:88', { fetcher }).post('session', sessionParams())
      expect(result).toMatchObject({ ok: false, error: { code: item.code, ...(item.status ? { status: item.status } : {}) } })
    }
  })

  it('detects a login redirect even when the final HTTP status is 200', async () => {
    const fetcher: typeof fetch = async () => jsonResponse(
      { anything: true }, 200, 'http://183.36.43.66:88/Login.aspx'
    )
    const result = await new EasyTransport('http://183.36.43.66:88', { fetcher }).post('session', sessionParams())
    expect(result).toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } })
  })

  it('aborts on timeout and respects explicit cancellation', async () => {
    const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
    const timed = await new EasyTransport('http://183.36.43.66:88', { fetcher, timeoutMs: 5 }).post('session', sessionParams())
    expect(timed).toMatchObject({ ok: false, error: { code: 'REQUEST_TIMEOUT' } })
    const controller = new AbortController()
    const pending = new EasyTransport('http://183.36.43.66:88', { fetcher }).post('session', sessionParams(), controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'REQUEST_ABORTED' } })
  })
})
