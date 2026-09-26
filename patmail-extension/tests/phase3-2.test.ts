import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LiveEasyAcceptanceRunner } from '../src/automation/acceptance-runner'
import { readonlyContract } from '../src/automation/readonly-contracts'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { SerialTaskStore } from '../src/automation/indexed-store'
import { buildTask } from '../src/automation/task-builder'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { handleAuthorityMessage } from '../src/background/authority'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { loadAccount, type LocalArea } from '../src/background/account-data'
import { canCommitWorkspaceResponse } from '../src/app/composables/useWorkspace'
import type { CustomerQueryProfile } from '../src/customer/types'
import { emptyMailRules } from '../src/mail'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { EasyConnectionController, sameConnectionSnapshot, scopeFromConnection, type ConnectionSnapshot } from '../src/shared/connection'
import { MessageType } from '../src/shared/message'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')
const userB = guid('bbbbbbbb')

function memoryArea(): LocalArea & { dump(): Record<string, unknown> } {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) },
    dump: () => store
  }
}
function profile(name = '客户A'): CustomerQueryProfile {
  return { id: 'profile-a', name, baseTemplateId: 'base', overrides: { case_volume: 'ABC' }, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(operator = userA): MailRuleBundle {
  return { ...emptyMailRules(operator), revision: 1 }
}
function file(): SelectedPatentFile {
  return {
    fileId: 'file-a', fileName: 'a.pdf', fileDescription: '专利证书', customerName: '客户A', customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: '客户A', confirmed: true, source: 'explicit' }
  }
}
function session(userId: string) {
  return {
    type: MessageType.SessionResult,
    payload: { ok: true as const, data: { status: 'authenticated', userId, displayName: userId === userA ? '测试员' : '用户乙', checkedAt: '2026-09-26T00:00:00.000Z' } }
  }
}
function host(userId = userA): WorkspaceHost {
  const tabs = [{ id: 3, url: `${origin}/inbox`, title: 'EASY' }]
  const connection = new EasyConnectionController()
  let current = userId
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
    sendToTab: async () => session(current),
    switchUser(next: string) { current = next }
  } as WorkspaceHost & { switchUser(next: string): void }
}

async function bind(runtime: WorkspaceHost) {
  const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
  if (bound.type !== MessageType.WorkspaceResult || !bound.payload.ok) throw new Error('bind')
  const scope = scopeFromConnection(runtime.connection.context)
  if (!scope) throw new Error('scope')
  return scope
}

describe('Phase 3.2 写入入口、账号隔离与只读契约', () => {
  it('rejects a late account response and a stale form save', async () => {
    expect(canCommitWorkspaceResponse({
      requestId: 1, latestRequestId: 2, expectedOrigin: origin, responseOrigin: origin, responseOperatorId: userA, responseAuthenticated: true
    })).toBe(false)
    expect(canCommitWorkspaceResponse({
      requestId: 2, latestRequestId: 2, expectedOrigin: origin, responseOrigin: origin, responseOperatorId: userB, responseAuthenticated: true
    })).toBe(true)
    expect(canCommitWorkspaceResponse({
      requestId: 2, latestRequestId: 2, expectedOrigin: origin, responseOrigin: origin, responseOperatorId: '', responseAuthenticated: true
    })).toBe(false)

    const runtime = host()
    const scopeA = await bind(runtime)
    const saved = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile(), expectedScope: scopeA } }, runtime)
    if (saved.type !== MessageType.WorkspaceResult) throw new Error('save')
    expect(saved.payload.ok).toBe(true)
    ;(runtime as WorkspaceHost & { switchUser(next: string): void }).switchUser(userB)
    const refreshed = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'refreshSession' } }, runtime)
    if (refreshed.type !== MessageType.WorkspaceResult) throw new Error('refresh')
    expect(refreshed.payload.connection.operatorId).toBe(userB)
    const stale = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'saveCustomer', profile: profile('客户A被写入乙'), expectedScope: scopeA, expectedRevision: 1 }
    }, runtime)
    if (stale.type !== MessageType.WorkspaceResult) throw new Error('stale')
    expect(stale.payload.ok).toBe(false)
    expect(stale.payload.message).toMatch(/不一致|会话已变化/)
    const accountB = await loadAccount(runtime.area, origin, userB)
    expect(accountB.customers).toEqual([])
    const accountA = await loadAccount(runtime.area, origin, userA)
    expect(accountA.customers.map(item => item.name)).toEqual(['客户A'])
  })

  it('marks tasks stale from the shared customer save and rejects forged tasks', async () => {
    const runtime = host()
    const scope = await bind(runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveRules', bundle: rules(), expectedScope: scope } }, runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile(), expectedScope: scope } }, runtime)
    const planned = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'createTaskPlan', files: [file()], queryTemplateVersion: 1, expectedScope: scope }
    }, runtime)
    if (planned.type !== MessageType.WorkspaceResult || !planned.payload.ok) throw new Error(planned.type === MessageType.WorkspaceResult ? planned.payload.message : 'plan')
    const stored = planned.payload.tasks[0]
    expect(stored?.taskId).toBeTruthy()
    const account = await loadAccount(runtime.area, origin, userA)
    const current = account.customers[0]
    if (!current) throw new Error('customer')
    const renamed = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'saveCustomer', profile: { ...current, name: '客户A改' }, expectedScope: scope, expectedRevision: current.revision ?? 1 }
    }, runtime)
    if (renamed.type !== MessageType.WorkspaceResult) throw new Error('rename')
    expect(renamed.payload.ok).toBe(true)
    expect(renamed.payload.tasks.some(item => item.status === 'STALE')).toBe(true)
    const conflict = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'saveCustomer', profile: { ...current, name: '后写' }, expectedScope: scope, expectedRevision: current.revision ?? 1 }
    }, runtime)
    if (conflict.type !== MessageType.WorkspaceResult) throw new Error('conflict')
    expect(conflict.payload.ok).toBe(false)
    expect(conflict.payload.message).toContain('其他页面')

    const task = buildTask({ origin, operatorId: userA, files: [file()], rules: rules(), profiles: [profile()], queryTemplateVersion: 1, now: '2026-09-26T00:00:00.000Z' })
    const forged = await handleAuthorityMessage(
      { type: MessageType.SaveTask, payload: { task: { ...task, status: 'COMPLETED' } as unknown as Record<string, unknown> } },
      { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: runtime.tasks ?? new SerialTaskStore(null), evidence: runtime.evidence }
    )
    if (forged?.type !== MessageType.TaskResult) throw new Error('forged')
    expect(forged.payload.ok).toBe(false)
    expect(forged.payload.message).toContain('不能由页面声明')
    const wrong = await handleAuthorityMessage(
      { type: MessageType.SaveTask, payload: { task: { ...task, taskFingerprint: 'not-the-fingerprint' } as unknown as Record<string, unknown> } },
      { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: runtime.tasks ?? new SerialTaskStore(null), evidence: runtime.evidence }
    )
    if (wrong?.type !== MessageType.TaskResult) throw new Error('wrong')
    expect(wrong.payload.ok).toBe(false)
    expect(wrong.payload.message).toContain('指纹')
  })

  it('stops connection snapshot writes from repeating and keeps both editors on the background path', () => {
    const snapshot: ConnectionSnapshot = { easyOrigin: origin, easyTabId: 3, lastOperatorId: userA, connectionVersion: 2 }
    let persisted: ConnectionSnapshot | null = null
    let writes = 0
    let loads = 0
    const persist = (next: ConnectionSnapshot) => {
      if (sameConnectionSnapshot(persisted, next)) return
      persisted = next
      writes += 1
      if (loads > 0 && sameConnectionSnapshot(persisted, next)) return
      loads += 1
      persist(next)
    }
    persist(snapshot)
    persist(snapshot)
    expect(writes).toBe(1)
    expect(loads).toBe(1)

    const customers = readFileSync(path.join(process.cwd(), 'src/app/pages/CustomersPage.vue'), 'utf8')
    const templates = readFileSync(path.join(process.cwd(), 'src/floating/QueryTemplateSection.vue'), 'utf8')
    const search = readFileSync(path.join(process.cwd(), 'src/floating/FileSearchPanel.vue'), 'utf8')
    expect(customers).toContain("action: 'saveCustomer'")
    expect(customers).toContain('expectedScope')
    expect(templates).toContain("action: 'saveCustomer'")
    expect(templates).toContain("action: 'saveQueryTemplate'")
    expect(templates).not.toContain('CustomerQueryService')
    expect(templates).not.toContain('ChromeBundleRepository')
    expect(search).not.toContain('ChromeBundleRepository')
  })

  it('builds confirmed request fields and does not pass business or mock failures', async () => {
    const mail = guid('eeeeeeee')
    const flow = readonlyContract('GetFlowInfo', { mailId: mail, flowType: 'CO' })
    if (flow.state !== 'ready') throw new Error(flow.reason)
    expect(flow.params.get('obj_id')).toBe(mail)
    expect(flow.params.get('mail_id')).toBeNull()
    const tree = readonlyContract('LoadFileTypeByCaseType', { caseTypeId: mail })
    if (tree.state !== 'ready') throw new Error(tree.reason)
    expect(tree.params.get('case_type')).toBe(mail)
    expect(tree.params.get('case_type_id')).toBeNull()
    const info = readonlyContract('GetMailInfo', { mailId: mail })
    if (info.state !== 'ready') throw new Error(info.reason)
    expect(info.params.get('mail_id')).toBe(mail)
    expect(readonlyContract('GetMailInfo', {}).state).toBe('blocked')
    expect(readonlyContract('GetFlowSubmit', { mailId: mail, flowType: 'CO' }).state).toBe('pending')
    expect(readonlyContract('GetSearchFiles', {}).state).toBe('pending')

    const runner = new LiveEasyAcceptanceRunner({
      kind: 'live',
      call: async () => ({ httpStatus: 200, sessionOk: true, fields: { userId: userA, clientStatus: 'false' }, shape: 'object' })
    })
    const failed = await runner.run({ origin, operatorId: userA, call: 'GetUserModel' })
    expect(failed.result).toBe('FAIL')
    expect(failed.reason).toContain('业务状态未通过')
    const gateway = await new LiveEasyAcceptanceRunner({
      kind: 'live',
      call: async () => ({ httpStatus: 502, sessionOk: true, fields: {}, shape: 'error' })
    }).run({ origin, operatorId: userA, call: 'GetFlowSubmit' })
    expect(gateway.result).not.toBe('PASS')
    const mock = await new LiveEasyAcceptanceRunner({
      kind: 'mock',
      call: async () => ({ httpStatus: 200, sessionOk: true, fields: { userId: userA }, shape: 'object' })
    }).run({ origin, operatorId: userA, call: 'GetUserModel' })
    expect(mock.result).toBe('BLOCKED')
    expect(mock.reason).toContain('现场证据')
  })
})
