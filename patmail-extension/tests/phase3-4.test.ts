import { describe, expect, it } from 'vitest'
import { LiveEasyAcceptanceRunner } from '../src/automation/acceptance-runner'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { SerialTaskStore } from '../src/automation/indexed-store'
import { readonlyContract } from '../src/automation/readonly-contracts'
import { stableFieldDigest } from '../src/automation/query-dependency'
import { buildTask } from '../src/automation/task-builder'
import { validateTask } from '../src/automation/task-validator'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { handleAuthorityMessage } from '../src/background/authority'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { saveCustomerAccount, type LocalArea } from '../src/background/account-data'
import { canCommitWorkspaceResponse } from '../src/app/composables/useWorkspace'
import type { CustomerQueryProfile } from '../src/customer/types'
import { emptyMailRules } from '../src/mail'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { EasyConnectionController, scopeFromConnection } from '../src/shared/connection'
import { MessageType } from '../src/shared/message'
import type { QueryTemplate } from '../src/query/query-types'
import { EASY_MAIL_WRITES_ENABLED } from '../src/mail/easy/gate'
import { WORKFLOW_WRITES_ENABLED } from '../src/workflow/gate'
import { productionWriteAllowed } from '../src/automation/contract-capture'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')

function memoryArea(): LocalArea {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) }
  }
}
function profile(id: string, name: string, overrides: Record<string, string> = { case_volume: 'ABC' }): CustomerQueryProfile {
  return { id, name, baseTemplateId: id === 'profile-b' ? 'base-b' : 'base-a', overrides, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function template(id: string, filetype: string): QueryTemplate {
  return {
    id, name: id, source: 'local', queryType: 'FileSearch',
    fields: { filetype }, version: 1, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z'
  }
}
function rules(): MailRuleBundle {
  return { ...emptyMailRules(userA), revision: 1 }
}
function file(profileId = 'profile-a'): SelectedPatentFile {
  return {
    fileId: 'file-a', fileName: 'a.pdf', fileDescription: '专利证书', customerName: '客户A', customerProfileId: profileId,
    customerBinding: { profileId, profileName: '客户A', sourceCustomerName: '客户A', confirmed: true, source: 'explicit' }
  }
}
function input(profiles: CustomerQueryProfile[], templates: QueryTemplate[], files: SelectedPatentFile[] = [file()]) {
  return { origin, operatorId: userA, files, rules: rules(), profiles, templates, queryTemplateVersion: 0, now: '2026-09-26T00:00:00.000Z' }
}
function session() {
  return {
    type: MessageType.SessionResult,
    payload: { ok: true as const, data: { status: 'authenticated', userId: userA, displayName: '测试员', checkedAt: '2026-09-26T00:00:00.000Z' } }
  }
}
function searchResult(fileId: string) {
  return {
    type: MessageType.SearchFilesResult,
    payload: {
      ok: true as const,
      data: {
        items: [{ fileId, fileName: 'a.pdf', fileDescription: '专利证书', customerName: '客户A', caseVolume: 'V1' }],
        total: 1, pageIndex: 1, pageSize: 20, totalPages: 1
      }
    }
  }
}
function host(): WorkspaceHost {
  const tabs = [{ id: 3, url: `${origin}/inbox`, title: 'EASY' }]
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
    sendToTab: async (_tabId, message) => message.type === MessageType.SearchFiles ? searchResult('file-a') : session()
  }
}
async function bind(runtime: WorkspaceHost) {
  const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
  if (bound.type !== MessageType.WorkspaceResult || !bound.payload.ok) throw new Error('bind')
  const scope = scopeFromConnection(runtime.connection.context)
  if (!scope) throw new Error('scope')
  return scope
}

describe('Phase 3.4 任务权威、依赖范围与文件来源', () => {
  it('rejects a forged completed item and a verified checkpoint that never sent a request', async () => {
    const built = buildTask(input([profile('profile-a', '客户A')], [template('base-a', '证书')]))
    const forged = {
      ...built,
      status: 'READY' as const,
      items: built.items.map(item => ({ ...item, status: 'COMPLETED' as const })),
      checkpoints: [{ stage: 'MAIL_CREATE' as const, itemId: '', requestSent: false, responseReceived: false, verified: true, easyMailId: '', at: '', note: '' }]
    }
    const rejected = await handleAuthorityMessage(
      { type: MessageType.SaveTask, payload: { task: forged as unknown as Record<string, unknown> } },
      { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: new SerialTaskStore(null), evidence: new MemoryEvidenceStore() }
    )
    if (rejected?.type !== MessageType.TaskResult) throw new Error('save')
    expect(rejected.payload.ok).toBe(false)
    expect(rejected.payload.message).toContain('不能由页面声明子任务完成')
    const verifiedOnly = { ...built, status: 'READY' as const, checkpoints: forged.checkpoints }
    const second = await handleAuthorityMessage(
      { type: MessageType.SaveTask, payload: { task: verifiedOnly as unknown as Record<string, unknown> } },
      { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: new SerialTaskStore(null), evidence: new MemoryEvidenceStore() }
    )
    if (second?.type !== MessageType.TaskResult) throw new Error('verified')
    expect(second.payload.message).toContain('不能由页面声明检查点')
  })

  it('keeps UNKNOWN when a stale READY update races an atomic transition', async () => {
    const store = new SerialTaskStore(null)
    const built = buildTask(input([profile('profile-a', '客户A')], [template('base-a', '证书')]))
    await store.save(built)
    const unknown = store.updateTaskAtomically(origin, userA, built.taskId, built.recordVersion ?? 1, current => ({
      ok: true, task: { ...current, status: 'UNKNOWN', readonly: true }
    }))
    const ready = store.updateTaskAtomically(origin, userA, built.taskId, built.recordVersion ?? 1, current => ({
      ok: true, task: { ...current, status: 'READY' }
    }))
    const [first, second] = await Promise.all([unknown, ready])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.message).toContain('任务版本已变化')
    const kept = (await store.list(origin, userA, true)).find(item => item.taskId === built.taskId)
    expect(kept?.status).toBe('UNKNOWN')
  })

  it('encodes template fields without newline or equals collisions', () => {
    expect(stableFieldDigest({ a: 'x\nb=y' })).not.toBe(stableFieldDigest({ a: 'x', b: 'y' }))
    expect(stableFieldDigest({ a: 'x', b: 'y' })).toBe(stableFieldDigest({ b: 'y', a: 'x' }))
    expect(stableFieldDigest({ a: '' })).not.toBe(stableFieldDigest({}))
    expect(stableFieldDigest({ note: '甲=乙\r\n丙' })).not.toBe(stableFieldDigest({ note: '甲', extra: '乙丙' }))
  })

  it('stales only the customer actually referenced by the task', () => {
    const profiles = [profile('profile-a', '客户A'), profile('profile-b', '客户B')]
    const templates = [template('base-a', '证书'), template('base-b', '通知')]
    const current = input(profiles, templates)
    const built = buildTask(current)
    expect(built.queryDependencies?.map(item => item.customerProfileId)).toEqual(['profile-a'])
    const otherCustomer = validateTask(built, { ...current, templates: [templates[0]!, { ...templates[1]!, fields: { filetype: '已改' } }] })
    expect(otherCustomer.status).not.toBe('STALE')
    const ownTemplate = validateTask(built, { ...current, templates: [{ ...templates[0]!, fields: { filetype: '已改' } }, templates[1]!] })
    expect(ownTemplate.status).toBe('STALE')
    const removed = validateTask(built, { ...current, profiles: [profiles[1]!] })
    expect(removed.status).toBe('STALE')
    const overrides = validateTask(built, { ...current, profiles: [{ ...profiles[0]!, overrides: { case_volume: 'CHANGED' } }, profiles[1]!] })
    expect(overrides.status).toBe('STALE')
    const legacy = { ...built }
    delete legacy.queryDependencies
    const unknownDependency = validateTask(legacy, current)
    expect(unknownDependency.dependencyState).toBe('LEGACY_DEPENDENCY_UNKNOWN')
    expect(unknownDependency.readonly).toBe(true)
    expect(unknownDependency.status).toBe('STALE')
  })

  it('requires an expected revision before overwriting a customer', async () => {
    const area = memoryArea()
    const saved = await saveCustomerAccount(area, origin, userA, profile('profile-a', '客户A'))
    await expect(saveCustomerAccount(area, origin, userA, { ...saved, name: '覆盖' })).rejects.toThrow('已有客户必须提供预期版本')
    const renamed = await saveCustomerAccount(area, origin, userA, { ...saved, name: '覆盖' }, saved.revision ?? 1)
    expect(renamed.name).toBe('覆盖')
  })

  it('returns each same-account mutation receipt', () => {
    const shared = {
      expectedEpoch: 2, connectionEpoch: 2, expectedOrigin: origin, responseOrigin: origin,
      responseOperatorId: userA, responseAuthenticated: true
    }
    expect(canCommitWorkspaceResponse({ ...shared, requestId: 1, latestRequestId: 4, latestMutationId: 2, kind: 'mutation' })).toBe(true)
    expect(canCommitWorkspaceResponse({ ...shared, requestId: 2, latestRequestId: 4, latestMutationId: 2, kind: 'mutation' })).toBe(true)
    expect(canCommitWorkspaceResponse({ ...shared, requestId: 2, latestRequestId: 4, latestMutationId: 2, kind: 'mutation', connectionEpoch: 3 })).toBe(false)
  })

  it('upgrades file provenance only for ids present in the observed search', async () => {
    const runtime = host()
    const scope = await bind(runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveRules', bundle: rules(), expectedScope: scope } }, runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile('profile-a', '客户A'), expectedScope: scope } }, runtime)
    const searched = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'forward', message: { type: MessageType.SearchFiles, payload: { query: { pageIndex: 1, pageSize: 20 } } } }
    }, runtime)
    if (searched.type !== MessageType.WorkspaceResult || !searched.payload.forwarded || searched.payload.forwarded.type !== MessageType.SearchFilesResult || !searched.payload.forwarded.payload.ok) throw new Error('search')
    const sessionId = searched.payload.forwarded.payload.data.querySessionId
    const planned = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'createTaskPlan', files: [{ ...file(), querySessionId: sessionId }], queryTemplateVersion: 0, expectedScope: scope }
    }, runtime)
    if (planned.type !== MessageType.WorkspaceResult) throw new Error('plan')
    expect(planned.payload.createdTask?.fileSource).toBe('SEARCH_RESPONSE_OBSERVED')
    const missing = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'createTaskPlan', files: [{ ...file(), fileId: 'not-in-the-query', querySessionId: sessionId }], queryTemplateVersion: 0, expectedScope: scope }
    }, runtime)
    if (missing.type !== MessageType.WorkspaceResult) throw new Error('missing')
    expect(missing.payload.createdTask?.fileSource).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('leaves unconfirmed contracts pending and keeps production writes closed', async () => {
    for (const call of ['GetSearchFiles', 'GetMailRule', 'GetCustomerContact', 'GetSignature', 'GetFlowSubmit']) {
      expect(readonlyContract(call, { mailId: guid('mailmail'), flowType: 'CO' }).state).toBe('pending')
    }
    const runner = new LiveEasyAcceptanceRunner({
      kind: 'live',
      async call() { return { httpStatus: 200, sessionOk: true, fields: { userId: userA }, shape: 'object' } }
    })
    const matched = await runner.run({ call: 'GetUserModel', origin, operatorId: userA, expected: { userId: userA } })
    expect(matched.acceptanceLayer).toBe('MANUAL_COMPARED')
    expect(matched.evidenceLevel).not.toBe('UI_COMPARED')
    expect(EASY_MAIL_WRITES_ENABLED).toBe(false)
    expect(WORKFLOW_WRITES_ENABLED).toBe(false)
    expect(productionWriteAllowed()).toBe(false)
  })
})
