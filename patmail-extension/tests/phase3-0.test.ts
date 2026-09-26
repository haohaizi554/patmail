import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { downgradeClientAcceptance, downgradeClientEvidence } from '../src/automation/acceptance-trust'
import { handleAuthorityMessage } from '../src/background/authority'
import { loadAccount, refreshStaleTasks, saveCustomerAccount, saveRuleAccount, type LocalArea } from '../src/background/account-data'
import { scopeExtensionPageMessage } from '../src/background/scope'
import { handleWorkspaceMessage, openWorkspaceTab, type WorkspaceHost } from '../src/background/workspace'
import { MemoryEvidenceStore, type StoredEvidence } from '../src/automation/evidence-store'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { SerialTaskStore } from '../src/automation/indexed-store'
import { buildTask } from '../src/automation/task-builder'
import { describeTaskRecord } from '../src/app/record-status'
import { productionWriteAllowed } from '../src/automation/contract-capture'
import type { CustomerQueryProfile } from '../src/customer/types'
import { applyConfirmedBind, emptyMailRules, selectPage, toSelectedFile } from '../src/mail'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { EASY_MAIL_WRITES_ENABLED } from '../src/mail/easy/gate'
import { EasyConnectionController, chooseAppTab, emptyConnection } from '../src/shared/connection'
import { MessageType, isMessage } from '../src/shared/message'
import { WORKFLOW_WRITES_ENABLED } from '../src/workflow/gate'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')
const userB = guid('bbbbbbbb')
const mailType = guid('cccccccc')

function memoryArea(): LocalArea {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) }
  }
}
function file(id: string): SelectedPatentFile {
  return {
    fileId: id, fileName: `${id}.pdf`, fileDescription: '专利证书', customerName: '客户A', customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: '客户A', confirmed: true, source: 'explicit' }
  }
}
function profile(): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', easyCustomerId: guid('dddddddd'), baseTemplateId: 'base', overrides: {}, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(operator = userA): MailRuleBundle {
  return {
    ...emptyMailRules(operator), revision: 2,
    policies: [{ customerProfileId: 'profile-a', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    mappings: [{ id: 'map-1', fileDescriptionText: '专利证书', mailTypeId: mailType, mailTypeName: '证书通知', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    recipients: [{ id: 'to-a', customerProfileId: 'profile-a', name: '默认', to: ['a@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    signatures: [{ id: 'sign', operatorId: operator, name: '默认签名', content: '此致', enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    subject: { template: '关于{文件名称}的通知', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 },
    body: { template: '请查收。', supplement: '', version: 1 }
  }
}
function session(userId: string, status = 'authenticated') {
  return {
    type: MessageType.SessionResult,
    payload: status === 'authenticated'
      ? { ok: true as const, data: { status, userId, displayName: '测试员', checkedAt: '2026-09-26T00:00:00.000Z' } }
      : { ok: false as const, error: { code: 'SESSION_EXPIRED', message: '登录已失效。' } }
  }
}
function host(tabs: { id: number; url: string; title?: string }[], replies: unknown[] = []): WorkspaceHost {
  const connection = new EasyConnectionController()
  return {
    connection, area: memoryArea(), tasks: new SerialTaskStore(null), evidence: new MemoryEvidenceStore(),
    queryTabs: async () => tabs,
    getTab: async (tabId) => {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) throw new Error('closed')
      return tab
    },
    createTab: async () => undefined,
    focusTab: async () => undefined,
    openApp: async () => ({ tabId: 7, created: true }),
    sendToTab: async () => replies.shift()
  }
}

describe('完整页面入口与连接', () => {
  it('keeps the icon path on one app tab and removes the popup', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8')) as { action: { default_popup?: string } }
    expect(manifest.action.default_popup).toBeUndefined()
    const content = readFileSync(path.join(process.cwd(), 'src/content/index.ts'), 'utf8')
    expect(content).not.toContain('mountWhenReady()')
    const app = readFileSync(path.join(process.cwd(), 'src/app/App.vue'), 'utf8')
    expect(app).not.toContain('data.js')
    const first = chooseAppTab([], 'chrome-extension://abc/app.html')
    expect(first).toEqual({ action: 'create' })
    const tabs = [{ id: 4, url: 'chrome-extension://abc/app.html#/files' }]
    expect(chooseAppTab(tabs, 'chrome-extension://abc/app.html')).toEqual({ action: 'focus', id: 4 })
    expect(chooseAppTab(tabs, 'chrome-extension://abc/app.html')).toEqual({ action: 'focus', id: 4 })
  })

  it('does not pick an EASY tab until the user chooses one', async () => {
    const none = host([])
    const listed = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'listTabs' } }, none)
    expect(listed.type).toBe(MessageType.WorkspaceResult)
    if (listed.type !== MessageType.WorkspaceResult) return
    expect(listed.payload.tabs).toEqual([])
    expect(listed.payload.connection.easyTabId).toBeNull()
    expect(listed.payload.message).toContain('尚未连接')

    const many = host([
      { id: 1, url: `${origin}/a`, title: '甲' },
      { id: 2, url: `${origin}/b`, title: '乙' }
    ], [session(userB)])
    const choices = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'listTabs' } }, many)
    if (choices.type !== MessageType.WorkspaceResult) throw new Error('tabs')
    expect(choices.payload.tabs.map(item => item.id)).toEqual([1, 2])
    expect(many.connection.context.easyTabId).toBeNull()
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 2 } }, many)
    if (bound.type !== MessageType.WorkspaceResult) throw new Error('bind')
    expect(bound.payload.connection.easyTabId).toBe(2)
    expect(bound.payload.connection.operatorId).toBe(userB)
    const wrong = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 9 } }, many)
    if (wrong.type !== MessageType.WorkspaceResult) throw new Error('wrong')
    expect(wrong.payload.ok).toBe(false)
  })

  it('drops the binding when the tab closes, refreshes, leaves EASY, or the user changes', async () => {
    const tabs = [{ id: 3, url: `${origin}/inbox`, title: 'EASY' }]
    const runtime = host(tabs, [session(userA), session(userB)])
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
    if (bound.type !== MessageType.WorkspaceResult) throw new Error('bind')
    expect(bound.payload.connection.operatorId).toBe(userA)
    const switched = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'refreshSession' } }, runtime)
    if (switched.type !== MessageType.WorkspaceResult) throw new Error('switch')
    expect(switched.payload.connection.operatorId).toBe(userB)
    expect(switched.payload.message).toContain('切换')
    runtime.connection.observeNavigation(3, `${origin}/inbox`)
    expect(runtime.connection.context.operatorId).toBe('')
    expect(runtime.connection.context.sessionStatus).toBe('pending')
    runtime.connection.observeNavigation(3, 'http://127.0.0.1/other')
    expect(runtime.connection.context.sessionStatus).toBe('error')
    expect(runtime.connection.context.easyTabId).toBeNull()
    const again = host([{ id: 5, url: `${origin}/inbox` }], [session(userA)])
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 5 } }, again)
    again.connection.detach(5)
    expect(again.connection.context.sessionStatus).toBe('disconnected')
    const expired = host([{ id: 6, url: `${origin}/inbox` }], [session(userA, 'expired')])
    const failed = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 6 } }, expired)
    if (failed.type !== MessageType.WorkspaceResult) throw new Error('expired')
    expect(failed.payload.connection.operatorId).toBe('')
    expect(failed.payload.connection.sessionStatus).toBe('expired')
  })

  it('opens one workspace tab and focuses it the next time', async () => {
    const opened = await openWorkspaceTab([], 'chrome-extension://abc/app.html', async () => undefined, async () => 11)
    expect(opened).toEqual({ tabId: 11, created: true })
    const focused = await openWorkspaceTab([{ id: 11, url: 'chrome-extension://abc/app.html#/tasks' }], 'chrome-extension://abc/app.html', async () => undefined, async () => 99)
    expect(focused).toEqual({ tabId: 11, created: false })
  })
})

describe('完整页面数据与证据', () => {
  it('keeps customers and rules in the confirmed account and marks changed tasks stale', async () => {
    const area = memoryArea()
    const store = new SerialTaskStore(null)
    expect(await loadAccount(area, origin, 'session')).toEqual({ customers: [], templates: [], rules: null })
    await saveCustomerAccount(area, origin, userA, profile())
    expect((await loadAccount(area, origin, userB)).customers).toEqual([])
    expect((await loadAccount(area, origin, userA)).customers.map(item => item.name)).toEqual(['客户A'])
    const initial = rules()
    initial.revision = 1
    const storedRules = await saveRuleAccount(area, origin, userA, initial, null)
    const task = buildTask({ origin, operatorId: userA, files: [file('file-a')], rules: storedRules, profiles: [profile()], queryTemplateVersion: 1, now: '2026-09-26T00:00:00.000Z' })
    const unknown = { ...task, taskId: 'unknown-task', status: 'UNKNOWN' as const, readonly: true }
    await store.save(task)
    await store.save(unknown)
    const changed = { ...storedRules, subject: { ...storedRules.subject, template: '新的{文件名称}' } }
    await saveRuleAccount(area, origin, userA, changed, store)
    const saved = await store.list(origin, userA)
    expect(saved.find(item => item.taskId === task.taskId)?.status).toBe('STALE')
    expect(saved.find(item => item.legacyTaskId === 'unknown-task')?.status).toBe('UNKNOWN')
    expect(await store.list(origin, userB)).toEqual([])
  })

  it('does not let the full page read another operator or mint a passing proof', async () => {
    const denied = scopeExtensionPageMessage({ type: MessageType.ListTasks, payload: { origin, operatorId: userB } }, emptyConnection())
    expect(denied).toEqual({ error: '尚未确认 EASY 用户，不能读取其他账号的数据。' })
    const connection = { ...emptyConnection(), easyTabId: 1, operatorId: userA, sessionStatus: 'authenticated' as const, message: '' }
    const scoped = scopeExtensionPageMessage({ type: MessageType.ListTasks, payload: { origin: 'http://evil.example', operatorId: userB } }, connection)
    expect(scoped).toMatchObject({ payload: { origin, operatorId: userA } })
    const evidence = new MemoryEvidenceStore()
    const authority = { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: new SerialTaskStore(null), evidence }
    await handleAuthorityMessage({
      type: MessageType.SaveAcceptance,
      payload: { record: { id: '1', origin, operatorId: userA, call: 'GetUserModel', startedAt: '', finishedAt: '', httpStatus: 200, businessStatus: 'ok', requestShape: 'GetUserModel', responseShape: 'object', validatedFields: [], matchedWithUi: true, result: 'PASS', reason: '界面声明', evidenceHash: 'x' } }
    }, authority)
    expect(evidence.acceptance[0]?.result).toBe('BLOCKED')
    const forged: StoredEvidence = {
      evidenceId: 'e1', handler: 'MailCustomer', call: 'MailCustomer', origin, operatorIdHash: 'hash',
      requestShape: 'call', responseShape: 'object', httpStatus: 200, businessSuccess: true, readbackCall: 'GetMailInfo',
      readbackMatched: true, source: 'LIVE', level: 'READBACK_VERIFIED', capturedAt: '2026-09-26T00:00:00.000Z', verifiedAt: '2026-09-26T00:00:00.000Z', sampleHash: 'old'
    }
    expect(downgradeClientEvidence(forged).level).not.toBe('READBACK_VERIFIED')
    expect(downgradeClientEvidence(forged).businessSuccess).toBe(false)
    expect(downgradeClientAcceptance({ ...evidence.acceptance[0], result: 'PASS' }).result).toBe('BLOCKED')
  })

  it('selects files across pages and builds a local plan without claiming a send', () => {
    const pageOne = [toSelectedFile({ fileId: 'file-a', fileName: 'a.pdf', fileDescription: '专利证书', customerName: '客户A' })]
    const pageTwo = [toSelectedFile({ fileId: 'file-b', fileName: 'b.pdf', fileDescription: '专利证书', customerName: '客户A' })]
    const selected = applyConfirmedBind(selectPage(selectPage({}, pageOne, true), pageTwo, true), 'profile-a', '客户A', ['客户A'])
    expect(Object.keys(selected)).toEqual(['file-a', 'file-b'])
    expect(selected['file-a'].customerProfileId).toBe('profile-a')
    expect(selected['file-a'].customerId).not.toBe(profile().easyCustomerId)
    const task = buildTask({ origin, operatorId: userA, files: Object.values(selected), rules: rules(), profiles: [profile()], queryTemplateVersion: 1, now: '2026-09-26T00:00:00.000Z' })
    expect(task.mailDrafts.length).toBeGreaterThan(0)
    expect(describeTaskRecord(task.status)).not.toContain('已成功发送')
    expect(describeTaskRecord('COMPLETED')).toContain('发送未核验')
    expect(productionWriteAllowed()).toBe(false)
    expect(EASY_MAIL_WRITES_ENABLED).toBe(false)
    expect(WORKFLOW_WRITES_ENABLED).toBe(false)
    expect(isMessage({ type: MessageType.Workspace, payload: { action: 'forward', message: { type: MessageType.CreateEasyMail, payload: {} } } })).toBe(false)
  })
})
