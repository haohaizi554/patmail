import { afterEach, describe, expect, it } from 'vitest'
import { DictionaryService } from '../src/api/dictionaries/service'
import { EasyTransport } from '../src/api/transport'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { SerialTaskStore } from '../src/automation/indexed-store'
import type { LocalArea } from '../src/background/account-data'
import { fetchCustomerList } from '../src/customer/customer-list-load'
import { SME_SNAPSHOT_MISSING } from '../src/customer/sme-customers'
import { EasyConnectionController } from '../src/shared/connection'
import { MessageType, type MessageBridge } from '../src/shared/message'
import { setCustomerMode } from '../src/settings/customer-mode'

const guid = '50ba5fd7-030b-4de6-9c3a-f7a39ecefc3c'
const realFetch = globalThis.fetch

function memoryArea(): LocalArea {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) }
  }
}

function snapshotResponse(ok = true): Response {
  return new Response(JSON.stringify({
    takenAt: '2026-10-13T16:31:22+08:00',
    customers: [[guid, '海目星激光科技集团股份有限公司']]
  }), { status: ok ? 200 : 404 })
}

afterEach(async () => {
  globalThis.fetch = realFetch
  await setCustomerMode('large')
})

describe('中小客户名单不走原站', () => {
  it('页面直接读快照，不把名单请求转给原网站', async () => {
    await setCustomerMode('sme')
    globalThis.fetch = (async () => snapshotResponse()) as typeof fetch
    let forwarded = false
    const bridge: MessageBridge = {
      async request() {
        forwarded = true
        return { type: MessageType.Error, payload: { message: '请求超时，请重试。' } }
      }
    }
    const loaded = await fetchCustomerList(bridge, true)
    expect(forwarded).toBe(false)
    expect(loaded.ok).toBe(true)
    expect(loaded.customers).toEqual([{ id: guid, name: '海目星激光科技集团股份有限公司' }])
    expect(loaded.message).toContain('数据库快照')
    expect(loaded.takenAt).toBe('2026-10-13T16:31:22+08:00')
  })

  it('快照没读到时明确报错，仍然不请求原站', async () => {
    await setCustomerMode('sme')
    globalThis.fetch = (async () => snapshotResponse(false)) as typeof fetch
    let forwarded = false
    const bridge: MessageBridge = {
      async request() {
        forwarded = true
        return { type: MessageType.Error, payload: { message: '请求超时，请重试。' } }
      }
    }
    const loaded = await fetchCustomerList(bridge, true)
    expect(forwarded).toBe(false)
    expect(loaded.ok).toBe(false)
    expect(loaded.message).toBe(SME_SNAPSHOT_MISSING)
  })

  it('字典服务在中小客户模式下不调用 GetCustomerlist', async () => {
    await setCustomerMode('sme')
    globalThis.fetch = (async () => snapshotResponse()) as typeof fetch
    const calls: string[] = []
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body ?? ''))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const service = new DictionaryService(new EasyTransport('http://183.36.43.44:88', { fetcher, timeoutMs: 20 }))
    const result = await service.loadCustomerList('user', true)
    expect(calls).toEqual([])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.kind).toBe('customerList')
  })

  it('后台转发客户名单时就地读快照，不把请求送到 EASY 标签页', async () => {
    await setCustomerMode('sme')
    globalThis.fetch = (async () => snapshotResponse()) as typeof fetch
    const seen: number[] = []
    const host: WorkspaceHost = {
      connection: new EasyConnectionController(),
      area: memoryArea(),
      tasks: new SerialTaskStore(null),
      evidence: new MemoryEvidenceStore(),
      queryTabs: async () => [],
      getTab: async () => { throw new Error('closed') },
      createTab: async () => undefined,
      focusTab: async () => undefined,
      openApp: async () => ({ tabId: 1, created: false }),
      sendToTab: async (tabId) => {
        seen.push(tabId)
        return { type: MessageType.Error, payload: { message: '请求超时，请重试。' } }
      }
    }
    const response = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'forward', message: { type: MessageType.LoadDictionary, payload: { kind: 'customerList', force: true } } }
    }, host)
    expect(seen).toEqual([])
    expect(response.type).toBe(MessageType.WorkspaceResult)
    if (response.type !== MessageType.WorkspaceResult) return
    const forwarded = response.payload.forwarded
    expect(forwarded?.type).toBe(MessageType.DictionaryResult)
    if (forwarded?.type !== MessageType.DictionaryResult || !forwarded.payload.ok) return
    expect(forwarded.payload.data.kind).toBe('customerList')
    if (forwarded.payload.data.kind === 'customerList') expect(forwarded.payload.data.customers).toHaveLength(1)
  })
})
