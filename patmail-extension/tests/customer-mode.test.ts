import { afterEach, describe, expect, it } from 'vitest'
import { isEasyOrigin, SME_CUSTOMER_ORIGIN } from '../src/api/config'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { SerialTaskStore } from '../src/automation/indexed-store'
import type { LocalArea } from '../src/background/account-data'
import { EasyConnectionController } from '../src/shared/connection'
import { isMessage, MessageType } from '../src/shared/message'
import { expectedWorkspaceOrigin } from '../src/app/composables/useWorkspace'
import { customerMode, modeOrigin, originMatchesMode, originsForMode, setCustomerMode } from '../src/settings/customer-mode'

const large = 'http://183.36.43.66:88'
const sme = SME_CUSTOMER_ORIGIN
const userA = 'aaaaaaaa-1111-4111-8111-111111111111'

function memoryArea(): LocalArea {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) }
  }
}

function session(userId: string) {
  return {
    type: MessageType.SessionResult,
    payload: { ok: true as const, data: { status: 'authenticated', userId, displayName: '测试员', checkedAt: '2026-10-10T00:00:00.000Z' } }
  }
}

afterEach(async () => {
  await setCustomerMode('large')
})

describe('客户系统切换', () => {
  it('把中小客户站点登记成可信任的 EASY，业务地址和大客户分开', () => {
    expect(isEasyOrigin(sme)).toBe(true)
    expect(modeOrigin('large')).toBe(large)
    expect(modeOrigin('sme')).toBe(sme)
    expect(originsForMode('sme')).toEqual([sme])
    expect(originsForMode('large')).toContain(large)
    expect(originMatchesMode(sme, 'large')).toBe(false)
    expect(expectedWorkspaceOrigin({
      switchesSystem: false, sessionStatus: 'disconnected', easyOrigin: large, modeOrigin: sme
    })).toBe(sme)
    expect(expectedWorkspaceOrigin({
      switchesSystem: false, sessionStatus: 'authenticated', easyOrigin: sme, modeOrigin: sme
    })).toBe(sme)
    expect(isMessage({ type: MessageType.Workspace, payload: { action: 'setCustomerMode', mode: 'sme' } })).toBe(true)
    expect(isMessage({ type: MessageType.Workspace, payload: { action: 'setCustomerMode', mode: 'vip' } })).toBe(false)
  })

  it('中小客户模式只绑定 44，不把大客户页面当成当前系统', async () => {
    const seen: number[] = []
    const tabs = [
      { id: 3, url: `${large}/inbox`, title: '大客户' },
      { id: 8, url: `${sme}/inbox`, title: '中小客户' }
    ]
    const connection = new EasyConnectionController()
    connection.beginBind({ id: 3, url: `${large}/inbox` })
    connection.applySession({ ok: true, status: 'authenticated', userId: userA, displayName: '测试员' }, connection.context.connectionVersion)
    const host: WorkspaceHost = {
      connection,
      area: memoryArea(),
      tasks: new SerialTaskStore(null),
      evidence: new MemoryEvidenceStore(),
      queryTabs: async () => tabs,
      getTab: async (tabId) => {
        const tab = tabs.find(item => item.id === tabId)
        if (!tab) throw new Error('closed')
        return tab
      },
      createTab: async () => undefined,
      focusTab: async () => undefined,
      openApp: async () => ({ tabId: 7, created: true }),
      sendToTab: async (tabId) => {
        seen.push(tabId)
        return session(userA)
      }
    }
    const response = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'setCustomerMode', mode: 'sme' } }, host)
    expect(response.type).toBe(MessageType.WorkspaceResult)
    if (response.type !== MessageType.WorkspaceResult) return
    expect(customerMode()).toBe('sme')
    expect(response.payload.connection.easyOrigin).toBe(sme)
    expect(response.payload.connection.sessionStatus).toBe('authenticated')
    expect(response.payload.connection.easyTabId).toBe(8)
    expect(response.payload.tabs.map(tab => tab.origin)).toEqual([sme])
    expect(seen).toEqual([8])
    expect(connection.homeOrigin).toBe(sme)
  })

  it('切回大客户后不再停留在中小客户站点', async () => {
    await setCustomerMode('sme')
    const tabs = [{ id: 8, url: `${sme}/inbox`, title: '中小客户' }]
    const connection = new EasyConnectionController()
    connection.retarget(sme)
    connection.beginBind({ id: 8, url: `${sme}/inbox` })
    connection.applySession({ ok: true, status: 'authenticated', userId: userA, displayName: '测试员' }, connection.context.connectionVersion)
    const host: WorkspaceHost = {
      connection,
      area: memoryArea(),
      tasks: new SerialTaskStore(null),
      evidence: new MemoryEvidenceStore(),
      queryTabs: async () => tabs,
      getTab: async (tabId) => tabs.find(item => item.id === tabId) ?? (() => { throw new Error('closed') })(),
      createTab: async () => undefined,
      focusTab: async () => undefined,
      openApp: async () => ({ tabId: 7, created: false }),
      sendToTab: async () => session(userA)
    }
    const response = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'setCustomerMode', mode: 'large' } }, host)
    expect(response.type).toBe(MessageType.WorkspaceResult)
    if (response.type !== MessageType.WorkspaceResult) return
    expect(response.payload.connection.easyOrigin).toBe(large)
    expect(response.payload.connection.sessionStatus).not.toBe('authenticated')
    expect(response.payload.connection.message).toContain('大客户')
    expect(response.payload.tabs).toEqual([])
  })
})
