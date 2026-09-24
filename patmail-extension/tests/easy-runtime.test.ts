import { describe, expect, it } from 'vitest'
import { EasyRuntime } from '../src/api/client'

const authenticated = { ClientInfo: { IsLogin: true, Status: true, Result: true } }
const fileResponse = (name: string) => ({
  TableRows: [{ file_id: name, file_name: name }],
  TableRowsCount: '1',
  ClientInfo: authenticated.ClientInfo
})

describe('EASY Runtime 请求生命周期', () => {
  it('blocks file requests until a session is explicitly authenticated', async () => {
    let fileCalls = 0
    const fetcher: typeof fetch = async url => {
      if (String(url).endsWith('Login.ashx')) return new Response(JSON.stringify(authenticated))
      fileCalls++
      return new Response(JSON.stringify(fileResponse('文件 A')))
    }
    const runtime = new EasyRuntime('http://183.36.43.66:88', { fetcher })
    expect(await runtime.searchFiles({ caseVolume: 'A', pageIndex: 1, pageSize: 20 }))
      .toMatchObject({ ok: false, error: { code: 'AUTH_UNKNOWN' } })
    expect(fileCalls).toBe(0)
    expect(await runtime.checkSession()).toMatchObject({ ok: true, data: { status: 'authenticated' } })
    expect(await runtime.searchFiles({ caseVolume: 'A', pageIndex: 1, pageSize: 20 }))
      .toMatchObject({ ok: true, data: { items: [{ fileName: '文件 A' }] } })
  })

  it('deduplicates an identical in-flight search and prevents an old response overriding a newer one', async () => {
    const pending = new Map<string, (response: Response) => void>()
    let fileCalls = 0
    const fetcher: typeof fetch = async (_url, init) => {
      if (String(_url).endsWith('Login.ashx')) return new Response(JSON.stringify(authenticated))
      fileCalls++
      const key = new URLSearchParams(String(init?.body)).get('case_volume')!
      return new Promise(resolve => pending.set(key, resolve))
    }
    const runtime = new EasyRuntime('http://183.36.43.66:88', { fetcher })
    await runtime.checkSession()
    const first = runtime.searchFiles({ caseVolume: 'A', pageIndex: 1, pageSize: 20 })
    const duplicate = runtime.searchFiles({ caseVolume: 'A', pageIndex: 1, pageSize: 20 })
    expect(fileCalls).toBe(1)
    expect(duplicate).toBe(first)
    const second = runtime.searchFiles({ caseVolume: 'B', pageIndex: 1, pageSize: 20 })
    expect(fileCalls).toBe(2)
    pending.get('B')!(new Response(JSON.stringify(fileResponse('新结果'))))
    expect(await second).toMatchObject({ ok: true, data: { items: [{ fileName: '新结果' }] } })
    pending.get('A')!(new Response(JSON.stringify(fileResponse('旧结果'))))
    expect(await first).toMatchObject({ ok: false, error: { code: 'REQUEST_ABORTED' } })
  })

  it('cancels pending work and clears access after a session-expired business response', async () => {
    let resolveFile: ((response: Response) => void) | undefined
    let expired = false
    const fetcher: typeof fetch = async url => {
      if (String(url).endsWith('Login.ashx')) return new Response(JSON.stringify(authenticated))
      if (expired) return new Response(JSON.stringify({
        TableRows: null, TableRowsCount: '0', ClientInfo: { IsLogin: false, Status: false }
      }))
      return new Promise(resolve => { resolveFile = resolve })
    }
    const runtime = new EasyRuntime('http://183.36.43.66:88', { fetcher })
    await runtime.checkSession()
    const pending = runtime.searchFiles({ caseVolume: 'A', pageIndex: 1, pageSize: 20 })
    runtime.cancelFileSearch()
    resolveFile!(new Response(JSON.stringify(fileResponse('迟到结果'))))
    expect(await pending).toMatchObject({ ok: false, error: { code: 'REQUEST_ABORTED' } })
    expired = true
    expect(await runtime.searchFiles({ caseVolume: 'B', pageIndex: 1, pageSize: 20 }))
      .toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } })
    expect(runtime.sessionStatus).toBe('expired')
    expect(await runtime.searchFiles({ caseVolume: 'C', pageIndex: 1, pageSize: 20 }))
      .toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } })
  })
})
