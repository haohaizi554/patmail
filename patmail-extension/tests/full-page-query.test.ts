import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFullPageBridge } from '../src/app/services/full-page-bridge'
import { EasyRuntime } from '../src/api/client'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { handleWorkspaceMessage, workspaceResult, type WorkspaceHost } from '../src/background/workspace'
import { EasyConnectionController, emptyConnection } from '../src/shared/connection'
import { isMessage, MessageType, type BackgroundRequest, type ContentRequest } from '../src/shared/message'

const origin = 'http://183.36.43.66:88'
const userId = '11111111-1111-4111-8111-111111111111'
const query: ContentRequest = {
  type: MessageType.SearchLimitMonitor,
  payload: { query: { type: 'all', customerName: '广汽丰田', fields: { customer_name: '广汽丰田' }, pageIndex: 1, pageSize: 10 } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function runtimeChrome(extra: Record<string, unknown>): void {
  const listeners = new Set<(message: unknown, sender: chrome.runtime.MessageSender) => void>()
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'patmail-test',
      lastError: undefined,
      ...extra,
      onMessage: {
        addListener(fn: (message: unknown, sender: chrome.runtime.MessageSender) => void) { listeners.add(fn) },
        removeListener(fn: (message: unknown, sender: chrome.runtime.MessageSender) => void) { listeners.delete(fn) }
      }
    }
  })
}

function background(reply: (message: BackgroundRequest) => Promise<unknown>): void {
  runtimeChrome({
    sendMessage(envelope: unknown, callback: (value: unknown) => void) {
      const wrapped = envelope !== null && typeof envelope === 'object' && (envelope as { channel?: string }).channel === 'patmail-call'
      const message = wrapped ? (envelope as { message: BackgroundRequest }).message : envelope as BackgroundRequest
      void reply(message).then(callback)
    }
  })
}

describe('full-page query message chain', () => {
  it('delivers a customer-only deadline query through the workspace to the HTTP transport and back', async () => {
    const requests: { url: string; method: string; credentials?: RequestCredentials; body: URLSearchParams }[] = []
    const runtime = new EasyRuntime(origin, { fetcher: async (url, init) => {
      const body = new URLSearchParams(String(init?.body))
      requests.push({ url: String(url), method: init?.method ?? '', credentials: init?.credentials, body })
      const data = body.get('Call') === 'GetUserModel'
        ? { UserModel: { user_id: userId, Name: '测试员' }, ClientInfo: { IsLogin: true, Status: true, Result: false } }
        : { ClientInfo: { IsLogin: true, Status: true, Result: false }, TableRowsCount: '1', TableRows: [
            { proc_id: '22222222-2222-4222-8222-222222222222', case_volume: 'LIMIT-001', customer_name: '广汽丰田' }
          ] }
      return new Response(JSON.stringify(data))
    } })
    const connection = new EasyConnectionController()
    connection.beginBind({ id: 8, url: `${origin}/Main.aspx` })
    connection.applySession({ ok: true, status: 'authenticated', userId }, connection.context.connectionVersion)
    const host: WorkspaceHost = {
      connection, area: { get: async () => ({}), set: async () => undefined },
      tasks: null, evidence: new MemoryEvidenceStore(),
      queryTabs: async () => [{ id: 8, url: `${origin}/Main.aspx` }],
      getTab: async () => ({ id: 8, url: `${origin}/Main.aspx` }),
      createTab: async () => undefined, focusTab: async () => undefined,
      openApp: async () => ({ tabId: 9, created: false }),
      sendToTab: async (tabId, message) => {
        expect(tabId).toBe(8)
        if (message.type === MessageType.CheckSession) {
          return { type: MessageType.SessionResult, payload: await runtime.checkSession() }
        }
        if (message.type === MessageType.SearchLimitMonitor) {
          return { type: MessageType.SearchLimitMonitorResult, payload: await runtime.searchLimitMonitor(message.payload.query) }
        }
        throw new Error(`Unexpected content request: ${message.type}`)
      }
    }
    background(async message => {
      // Exercise the same envelope validation as the service worker before dispatch.
      expect(isMessage(message)).toBe(true)
      return handleWorkspaceMessage(message, host)
    })
    try {
      const result = await createFullPageBridge().request(query)
      expect(result).toMatchObject({ type: MessageType.SearchLimitMonitorResult, payload: {
        ok: true, data: { total: 1, items: [{ caseVolume: 'LIMIT-001', customerName: '广汽丰田' }] }
      } })
      const searches = requests.filter(request => request.body.get('Call') === 'GetLimitMonitorCaseList')
      expect(searches).toHaveLength(1)
      expect(searches[0]).toMatchObject({ url: `${origin}/AjaxServers/Report.ashx`, method: 'POST', credentials: 'include' })
      expect(searches[0]!.body.get('customer_name')).toBe('广汽丰田')
      expect(searches[0]!.body.get('is_first')).toBe('false')
      expect(searches[0]!.body.get('type')).toBe('all')
    } finally {
      runtime.dispose()
    }
  })

  it.each(['background', 'content'] as const)('preserves the %s error instead of reporting an empty EASY result', async stage => {
    const error = { type: MessageType.Error, payload: { message: `${stage}: 请刷新 EASY 标签页。` } }
    background(async () => stage === 'background' ? error : workspaceResult({ ok: true, connection: emptyConnection(), forwarded: error }))
    expect(await createFullPageBridge().request(query)).toEqual(error)
  })

  it('reports a closed Chrome message channel with the actual runtime reason', async () => {
    runtimeChrome({
      lastError: { message: 'The message port closed before a response was received.' },
      sendMessage(_message: unknown, callback: (value: unknown) => void) { callback(undefined) }
    })
    expect(await createFullPageBridge().request(query)).toMatchObject({ type: MessageType.Error, payload: {
      message: expect.stringContaining('message port closed')
    } })
  })

  it('reports a background timeout instead of confusing it with an empty search result', async () => {
    vi.useFakeTimers()
    runtimeChrome({ sendMessage() {} })
    const pending = createFullPageBridge().request(query)
    await vi.advanceTimersByTimeAsync(70_000)
    expect(await pending).toMatchObject({ type: MessageType.Error, payload: { message: expect.stringContaining('时限') } })
  })
})
