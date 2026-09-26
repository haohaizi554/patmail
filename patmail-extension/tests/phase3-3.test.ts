import { describe, expect, it } from 'vitest'
import { LiveEasyAcceptanceRunner } from '../src/automation/acceptance-runner'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { SerialTaskStore } from '../src/automation/indexed-store'
import { buildQueryDependencies, sameQueryDependencies, stableFieldDigest } from '../src/automation/query-dependency'
import { queryTemplateVersionOf } from '../src/automation/snapshot'
import { buildTask } from '../src/automation/task-builder'
import { validateTask } from '../src/automation/task-validator'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { handleAuthorityMessage } from '../src/background/authority'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { loadAccount, type LocalArea } from '../src/background/account-data'
import { absorbStorageEvent, canCommitWorkspaceResponse } from '../src/app/composables/useWorkspace'
import type { CustomerQueryProfile } from '../src/customer/types'
import { emptyMailRules } from '../src/mail'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { EasyConnectionController, scopeFromConnection } from '../src/shared/connection'
import { MessageType } from '../src/shared/message'
import type { QueryTemplate } from '../src/query/query-types'
import { EASY_MAIL_WRITES_ENABLED } from '../src/mail/easy/gate'
import { WORKFLOW_WRITES_ENABLED } from '../src/workflow/gate'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')
const userB = guid('bbbbbbbb')
const descriptionA = guid('aaaaaaaa')
const descriptionB = guid('bbbbbbbb')

function memoryArea(): LocalArea & { dump(): Record<string, unknown> } {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) },
    dump: () => store
  }
}
function profile(name = '客户A', overrides: Record<string, string> = { case_volume: 'ABC' }): CustomerQueryProfile {
  return { id: 'profile-a', name, baseTemplateId: 'base', overrides, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function template(filetype = descriptionA, version = 1): QueryTemplate {
  return {
    id: 'base', name: '基础模板', source: 'local', queryType: 'FileSearch',
    fields: { filetype }, version, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z'
  }
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
function host(userId = userA): WorkspaceHost & { switchUser(next: string): void } {
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
  }
}
async function bind(runtime: WorkspaceHost) {
  const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
  if (bound.type !== MessageType.WorkspaceResult || !bound.payload.ok) throw new Error('bind')
  const scope = scopeFromConnection(runtime.connection.context)
  if (!scope) throw new Error('scope')
  return scope
}
function armSwitch(runtime: WorkspaceHost, nextUser: string): void {
  let armed = true
  const area = runtime.area
  const original = area.get.bind(area)
  area.get = async (key: string) => {
    if (armed) {
      armed = false
      runtime.connection.context = { ...runtime.connection.context, operatorId: nextUser, displayName: '用户乙' }
    }
    return original(key)
  }
}

describe('Phase 3.3 可信任务、模板摘要与账号事务', () => {
  it('rejects SaveTask overwriting an UNKNOWN task that already sent a request', async () => {
    const runtime = host()
    const scope = await bind(runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveRules', bundle: rules(), expectedScope: scope } }, runtime)
    const built = buildTask({ origin, operatorId: userA, files: [file()], rules: rules(), profiles: [profile()], templates: [template()], queryTemplateVersion: 0, now: '2026-09-26T00:00:00.000Z' })
    const mailId = guid('mailmail')
    const stored = {
      ...built,
      status: 'UNKNOWN' as const,
      readonly: true,
      checkpoints: [{ stage: 'MAIL_CREATE' as const, itemId: '', requestSent: true, responseReceived: false, verified: false, easyMailId: mailId, at: '2026-09-26T00:00:00.000Z', note: 'sent' }],
      items: built.items.map(item => ({ ...item, easyMailId: mailId }))
    }
    await runtime.tasks?.save(stored)
    const incoming = {
      ...stored,
      status: 'READY' as const,
      readonly: false,
      checkpoints: [],
      items: stored.items.map(item => ({ ...item, easyMailId: '', workflowExecutionId: '' }))
    }
    const rejected = await handleAuthorityMessage(
      { type: MessageType.SaveTask, payload: { task: incoming as unknown as Record<string, unknown> } },
      { ledger: new ExecutionLedger(memoryTransactionStore(), 'owner'), tasks: runtime.tasks, evidence: runtime.evidence }
    )
    if (rejected?.type !== MessageType.TaskResult) throw new Error('save')
    expect(rejected.payload.ok).toBe(false)
    expect(rejected.payload.message).toContain('不能覆盖已有执行证据')
    const again = await runtime.tasks?.list(origin, userA, true)
    const kept = again?.find(item => item.taskId === stored.taskId)
    expect(kept?.status).toBe('UNKNOWN')
    expect(kept?.checkpoints[0]?.requestSent).toBe(true)
    expect(kept?.checkpoints[0]?.easyMailId).toBe(mailId)
    expect(kept?.items[0]?.easyMailId ?? mailId).toBe(mailId)
    expect(kept?.checkpoints).toHaveLength(1)
  })

  it('marks a task stale from template content even when the customer timestamp is unchanged', async () => {
    expect(queryTemplateVersionOf([{ id: 'a', updatedAt: '1' }])).toBe(0)
    expect(queryTemplateVersionOf([{ id: 'b', updatedAt: '2' }])).toBe(0)
    expect(stableFieldDigest({ filetype: descriptionA, case_volume: 'ABC' })).toBe(stableFieldDigest({ case_volume: 'ABC', filetype: descriptionA }))
    expect(stableFieldDigest({ filetype: descriptionA })).not.toBe(stableFieldDigest({ filetype: descriptionB }))
    expect(stableFieldDigest({ filetype: '' })).not.toBe(stableFieldDigest({}))
    const left = profile('甲')
    const right = { ...profile('乙'), id: 'profile-b' }
    expect(sameQueryDependencies(buildQueryDependencies([left, right], [template()]), buildQueryDependencies([right, left], [template()]))).toBe(true)

    const runtime = host()
    const scope = await bind(runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveRules', bundle: rules(), expectedScope: scope } }, runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveQueryTemplate', template: template(), expectedScope: scope, expectedVersion: null } }, runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile(), expectedScope: scope } }, runtime)
    const before = await loadAccount(runtime.area, origin, userA)
    const planned = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'createTaskPlan', files: [file()], queryTemplateVersion: 9, expectedScope: scope }
    }, runtime)
    if (planned.type !== MessageType.WorkspaceResult || !planned.payload.ok || !planned.payload.createdTask) throw new Error(planned.type === MessageType.WorkspaceResult ? planned.payload.message : 'plan')
    expect(planned.payload.createdTask.taskId).toBe(planned.payload.tasks[0]?.taskId)
    expect(planned.payload.createdTask.persisted).toBe(true)
    expect(planned.payload.createdTask.fileSource).toBe('FILE_SOURCE_UNVERIFIED')
    const taskId = planned.payload.createdTask.taskId
    const unchanged = validateTask((await runtime.tasks?.list(origin, userA))?.[0] ?? buildTask({ origin, operatorId: userA, files: [file()], rules: rules(), profiles: before.customers, templates: before.templates, queryTemplateVersion: 0 }), {
      origin, operatorId: userA, files: [file()], rules: before.rules ?? rules(), profiles: before.customers.map(item => ({ ...item, updatedAt: '1999-01-01T00:00:00.000Z' })), templates: before.templates, queryTemplateVersion: 0
    })
    expect(unchanged.status).not.toBe('STALE')

    const updated = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'saveQueryTemplate', template: template(descriptionB, 1), expectedScope: scope, expectedVersion: 1 }
    }, runtime)
    if (updated.type !== MessageType.WorkspaceResult) throw new Error('template')
    expect(updated.payload.ok).toBe(true)
    const after = await loadAccount(runtime.area, origin, userA)
    expect(after.customers[0]?.updatedAt).toBe(before.customers[0]?.updatedAt)
    expect(after.customers[0]?.id).toBe(before.customers[0]?.id)
    expect(after.customers[0]?.name).toBe(before.customers[0]?.name)
    expect(updated.payload.tasks.find(item => item.taskId === taskId)?.status).toBe('STALE')

    const fresh = buildTask({
      origin, operatorId: userA, files: [file()], rules: after.rules ?? rules(), profiles: after.customers,
      templates: [template(descriptionA, 1)], queryTemplateVersion: 0, now: '2026-09-26T00:00:00.000Z'
    })
    const input = { origin, operatorId: userA, files: [file()], rules: after.rules ?? rules(), queryTemplateVersion: 0 }
    expect(validateTask(fresh, { ...input, profiles: after.customers, templates: [{ ...template(descriptionA, 1), fields: { filetype: descriptionA } }] }).status).not.toBe('STALE')
    expect(validateTask(fresh, { ...input, profiles: after.customers.map(item => ({ ...item, overrides: { case_volume: '' } })), templates: [template(descriptionA, 1)] }).status).toBe('STALE')
    expect(validateTask(fresh, { ...input, profiles: after.customers, templates: [] }).status).toBe('STALE')
    expect(validateTask(fresh, { ...input, profiles: after.customers, templates: [template(descriptionB, 1)] }).status).toBe('STALE')
    expect(sameQueryDependencies(
      buildQueryDependencies(after.customers, [{ ...template(descriptionA, 1), fields: { filetype: descriptionA, case_volume: 'Z' } }]),
      buildQueryDependencies([...after.customers].reverse(), [{ ...template(descriptionA, 1), fields: { case_volume: 'Z', filetype: descriptionA } }])
    )).toBe(true)
  })

  it('does not mix account A data into account B when the connection changes during a read or save', async () => {
    const runtime = host()
    const scope = await bind(runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile(), expectedScope: scope } }, runtime)
    armSwitch(runtime, userB)
    const loaded = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'load' } }, runtime)
    if (loaded.type !== MessageType.WorkspaceResult) throw new Error('load')
    expect(loaded.payload.contextError).toBe('STALE_CONTEXT')
    expect(loaded.payload.ok).toBe(false)
    expect(loaded.payload.connection.operatorId).toBe(userB)
    expect(loaded.payload.customers).toEqual([])

    const writer = host()
    const scopeA = await bind(writer)
    armSwitch(writer, userB)
    const saved = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile('只属于甲'), expectedScope: scopeA } }, writer)
    if (saved.type !== MessageType.WorkspaceResult) throw new Error('save')
    expect(saved.payload.contextError).toBe('STALE_CONTEXT')
    expect(saved.payload.connection.operatorId).toBe(userB)
    expect(saved.payload.customers).toEqual([])
    expect((await loadAccount(writer.area, origin, userB)).customers).toEqual([])
    expect((await loadAccount(writer.area, origin, userA)).customers.map(item => item.name)).toEqual(['只属于甲'])
  })

  it('keeps a mutation receipt when a later read starts, and coalesces storage events', () => {
    expect(canCommitWorkspaceResponse({
      requestId: 1, latestRequestId: 4, latestMutationId: 1, kind: 'mutation', expectedEpoch: 2, connectionEpoch: 2,
      expectedOrigin: origin, responseOrigin: origin, responseOperatorId: userA, responseAuthenticated: true
    })).toBe(true)
    expect(canCommitWorkspaceResponse({
      requestId: 1, latestRequestId: 1, latestMutationId: 1, kind: 'mutation', expectedEpoch: 2, connectionEpoch: 3,
      expectedOrigin: origin, responseOrigin: origin, responseOperatorId: userA, responseAuthenticated: true
    })).toBe(false)
    expect(canCommitWorkspaceResponse({
      requestId: 1, latestRequestId: 2, kind: 'read', expectedEpoch: 2, connectionEpoch: 2,
      expectedOrigin: origin, responseOrigin: origin, responseOperatorId: userA, responseAuthenticated: true
    })).toBe(false)
    const deferred = absorbStorageEvent({ inflight: 1, pending: null }, 'data')
    expect(deferred.refresh).toBeNull()
    expect(deferred.pending).toBe('data')
    const rulesAndCustomers = absorbStorageEvent({ inflight: 1, pending: deferred.pending }, 'session')
    expect(rulesAndCustomers.pending).toBe('data')
    const flushed = absorbStorageEvent({ inflight: 0, pending: null }, rulesAndCustomers.pending)
    expect(flushed.refresh).toBe('data')
    const idle = absorbStorageEvent({ inflight: 0, pending: null }, 'data')
    expect(idle.refresh).toBe('data')
  })

  it('does not treat a manual expected field match as an independent UI comparison', async () => {
    const runner = new LiveEasyAcceptanceRunner({
      kind: 'live',
      async call() {
        return { httpStatus: 200, sessionOk: true, fields: { userId: userA, clientStatus: 'true' }, shape: 'object' }
      }
    })
    const matched = await runner.run({ origin, operatorId: userA, call: 'GetUserModel', expected: { userId: userA } })
    expect(matched.result).toBe('PASS')
    expect(matched.matchedWithUi).toBe(false)
    expect(matched.evidenceLevel).not.toBe('UI_COMPARED')
    expect(matched.evidenceSource).toBe('MANUAL_EXPECTATION')
    expect(matched.reason).not.toContain('原网站 UI')
    const business = await new LiveEasyAcceptanceRunner({
      kind: 'live',
      async call() { return { httpStatus: 200, sessionOk: true, fields: { clientStatus: 'false' }, shape: 'object' } }
    }).run({ origin, operatorId: userA, call: 'GetUserModel' })
    expect(business.result).toBe('FAIL')
    expect(EASY_MAIL_WRITES_ENABLED).toBe(false)
    expect(WORKFLOW_WRITES_ENABLED).toBe(false)
  })
})
