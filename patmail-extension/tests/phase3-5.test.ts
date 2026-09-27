import { beforeEach, describe, expect, it } from 'vitest'
import { SerialTaskStore } from '../src/automation/indexed-store'
import {
  clearQuerySessionStore,
  dropQuerySessionMemory,
  observeSearchPage,
  queryFingerprintOf,
  resolveSelectedFiles,
  sessionsFor
} from '../src/automation/file-search-snapshot'
import { buildTask } from '../src/automation/task-builder'
import { validateTask } from '../src/automation/task-validator'
import { refreshStaleTasks, saveRuleAccount, type LocalArea } from '../src/background/account-data'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import type { CustomerQueryProfile } from '../src/customer/types'
import { emptyMailRules } from '../src/mail'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import type { QueryTemplate } from '../src/query/query-types'
import { EasyConnectionController, scopeFromConnection } from '../src/shared/connection'
import { MessageType } from '../src/shared/message'
import type { FileSearchResult } from '../src/api/file-search-types'
import { EASY_MAIL_WRITES_ENABLED } from '../src/mail/easy/gate'
import { WORKFLOW_WRITES_ENABLED } from '../src/workflow/gate'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')
const userB = guid('bbbbbbbb')
const scopeA = { easyOrigin: origin, operatorId: userA, easyTabId: 3, connectionVersion: 1 }
const scopeB = { ...scopeA, operatorId: userB }

function memoryArea(): LocalArea {
  const store: Record<string, unknown> = {}
  return {
    async get(key) { return { [key]: store[key] } },
    async set(items) { Object.assign(store, items) }
  }
}
function profile(): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', baseTemplateId: 'base-a', overrides: { case_volume: 'ABC' }, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function template(filetype = '证书'): QueryTemplate {
  return { id: 'base-a', name: '基础模板', source: 'local', queryType: 'FileSearch', fields: { filetype }, version: 1, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(): MailRuleBundle {
  return { ...emptyMailRules(userA), revision: 1 }
}
function file(fileId: string, customerName = '客户甲', fileDescription = '专利证书'): SelectedPatentFile {
  return {
    fileId, fileName: `${fileId}.pdf`, fileDescription, customerName, customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: customerName, confirmed: true, source: 'explicit' }
  }
}
function page(items: FileSearchResult['items'], pageIndex: number): FileSearchResult {
  return { items, total: items.length, pageIndex, pageSize: 20, totalPages: 1 }
}
function patent(fileId: string, customerName: string, fileDescription: string) {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription, customerName, caseVolume: 'V1' }
}

beforeEach(async () => {
  await clearQuerySessionStore()
})

describe('Phase 3.5 查询会话、文件字段与任务回执', () => {
  it('keeps files from every page of the same query and separates a different query', async () => {
    const query = { caseVolume: 'Q1', pageIndex: 1, pageSize: 20 }
    const first = await observeSearchPage({ scope: scopeA, query, result: page([patent('A', '客户甲', '专利证书'), patent('B', '客户甲', '专利证书')], 1) })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope: scopeA,
      query: { ...query, pageIndex: 2 },
      result: page([patent('C', '客户甲', '专利证书')], 2),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    const sessions = await sessionsFor(scopeA)
    expect(sessions.filter(item => item.status === 'ACTIVE')).toHaveLength(1)
    expect(second.session.pages.map(item => item.pageIndex)).toEqual([1, 2])
    const bound = (id: string, customerName?: string, fileDescription?: string) => ({ ...file(id, customerName, fileDescription), querySessionId: first.session.querySessionId })
    const resolved = await resolveSelectedFiles([bound('A'), bound('B'), bound('C')], scopeA, { profiles: [profile()] })
    expect(resolved.selections.map(item => item.verification)).toEqual(['SEARCH_RESPONSE_OBSERVED', 'SEARCH_RESPONSE_OBSERVED', 'SEARCH_RESPONSE_OBSERVED'])
    expect(new Set(resolved.selections.map(item => item.querySessionId)).size).toBe(1)

    const other = { caseVolume: 'Q2', pageIndex: 1, pageSize: 20 }
    expect(queryFingerprintOf(query)).not.toBe(queryFingerprintOf(other))
    const nextRun = await observeSearchPage({ scope: scopeA, query: other, result: page([patent('D', '客户乙', '审查意见')], 1) })
    if (!nextRun.ok) throw new Error(nextRun.reason)
    expect(nextRun.session.querySessionId).not.toBe(first.session.querySessionId)
    const isolated = await sessionsFor(scopeA)
    expect(isolated.filter(item => item.status === 'ACTIVE')).toHaveLength(2)
    expect(isolated.find(item => item.queryFingerprint === queryFingerprintOf(other))?.files.map(item => item.fileId)).toEqual(['D'])
    const mixed = await resolveSelectedFiles([
      bound('A'),
      { ...file('D', '客户乙', '审查意见'), querySessionId: nextRun.session.querySessionId }
    ], scopeA, { profiles: [profile()] })
    expect(mixed.issue).toBe('MIXED_QUERY_SESSION')
    const built = buildTask({
      origin, operatorId: userA, files: mixed.files, rules: rules(), profiles: [profile()], templates: [template()],
      queryTemplateVersion: 0, verifiedSelection: mixed.selections, now: '2026-09-26T00:00:00.000Z'
    })
    expect(built.fileSource).toBe('FILE_SOURCE_UNVERIFIED')
    expect(built.identityGate?.mixedQuerySession).toBe(true)
    expect(built.verifiedSelection?.every(item => item.verification === 'SEARCH_RESPONSE_OBSERVED')).toBe(true)
  })

  it('rebuilds tampered file fields from the query snapshot and keeps the local binding', async () => {
    const observed = await observeSearchPage({
      scope: scopeA,
      query: { caseVolume: 'Q1', pageIndex: 1, pageSize: 20 },
      result: page([patent('A', '客户甲', '专利证书')], 1)
    })
    if (!observed.ok) throw new Error(observed.reason)
    const resolved = await resolveSelectedFiles([{
      ...file('A'),
      customerName: '客户乙',
      fileDescription: '审查意见通知书',
      querySessionId: observed.session.querySessionId
    }], scopeA, { profiles: [profile()] })
    expect(resolved.files[0]?.customerName).toBe('客户甲')
    expect(resolved.files[0]?.fileDescription).toBe('专利证书')
    expect(resolved.files[0]?.customerProfileId).toBe('profile-a')
    expect(resolved.files[0]?.customerBinding?.profileId).toBe('profile-a')
    expect(resolved.selections[0]?.sourceCustomerName).toBe('客户甲')
    expect(resolved.mismatches).toEqual(['A'])
    const otherAccount = await resolveSelectedFiles([{ ...file('A'), querySessionId: observed.session.querySessionId }], scopeB)
    expect(otherAccount.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('restores a query session after the memory cache is dropped and drops it when storage is cleared', async () => {
    const observed = await observeSearchPage({
      scope: scopeA,
      query: { caseVolume: 'Q1', pageIndex: 1, pageSize: 20 },
      result: page([patent('A', '客户甲', '专利证书')], 1)
    })
    if (!observed.ok) throw new Error(observed.reason)
    dropQuerySessionMemory()
    const restored = await resolveSelectedFiles([{ ...file('A'), querySessionId: observed.session.querySessionId }], scopeA, { profiles: [profile()] })
    expect(restored.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    await clearQuerySessionStore()
    const downgraded = await resolveSelectedFiles([{ ...file('A'), querySessionId: observed.session.querySessionId }], scopeA)
    expect(downgraded.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    const expiredRun = await observeSearchPage({
      scope: scopeA,
      query: { caseVolume: 'Q1', pageIndex: 1, pageSize: 20 },
      result: page([patent('A', '客户甲', '专利证书')], 1),
      observedAt: '2000-01-01T00:00:00.000Z'
    })
    if (!expiredRun.ok) throw new Error(expiredRun.reason)
    const expired = await resolveSelectedFiles([{ ...file('A'), querySessionId: expiredRun.session.querySessionId }], scopeA)
    expect(expired.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('returns PROTECTED_EVIDENCE instead of a silent save and does not turn UNKNOWN into STALE', async () => {
    const store = new SerialTaskStore(null)
    const built = buildTask({ origin, operatorId: userA, files: [file('A')], rules: rules(), profiles: [profile()], templates: [template()], queryTemplateVersion: 0, now: '2026-09-26T00:00:00.000Z' })
    await store.save({
      ...built,
      status: 'UNKNOWN',
      readonly: true,
      checkpoints: [{ stage: 'MAIL_CREATE', itemId: '', requestSent: true, responseReceived: false, verified: false, easyMailId: guid('mailmail'), at: '2026-09-26T00:00:00.000Z', note: 'sent' }]
    })
    const denied = await store.save({ ...built, status: 'READY', checkpoints: [] })
    expect(denied.ok).toBe(false)
    if (denied.ok) return
    expect(denied.code).toBe('PROTECTED_EVIDENCE')
    expect((await store.list(origin, userA, true))[0]?.status).toBe('UNKNOWN')
    const changed = template('已改')
    const report = await refreshStaleTasks(store, origin, userA, rules(), [profile()], [changed])
    expect(report.updatedCount).toBe(1)
    expect(report.protectedCount).toBe(0)
    const kept = (await store.list(origin, userA, true))[0]
    expect(kept?.status).toBe('UNKNOWN')
    expect(kept?.needsRevalidation).toBe(true)
    expect(kept?.checkpoints[0]?.requestSent).toBe(true)
    const blocked = new SerialTaskStore(null)
    await blocked.save(built)
    blocked.updateTaskAtomically = async () => ({ ok: false, code: 'PROTECTED_EVIDENCE', message: '不能覆盖已有执行证据。' })
    const skipped = await refreshStaleTasks(blocked, origin, userA, rules(), [profile()], [changed])
    expect(skipped.updatedCount).toBe(0)
    expect(skipped.protectedCount).toBe(1)
    expect((await blocked.list(origin, userA))[0]?.status).not.toBe('STALE')
  })

  it('reports rule save success when task revalidation fails', async () => {
    const area = memoryArea()
    const store = new SerialTaskStore(null)
    const saved = await saveRuleAccount(area, origin, userA, rules(), null)
    const built = buildTask({ origin, operatorId: userA, files: [file('A')], rules: saved, profiles: [profile()], templates: [template()], queryTemplateVersion: 0, now: '2026-09-26T00:00:00.000Z' })
    await store.save(built)
    store.updateTaskAtomically = async () => { throw new Error('核验存储失败') }
    const outcome = await saveRuleAccount(area, origin, userA, { ...saved, subject: { ...saved.subject, template: '新的标题' } }, store)
    expect(outcome.rulesSaved).toBe(true)
    expect(outcome.tasksRevalidated).toBe(false)
    expect(outcome.pendingRevalidation).toBe(true)
    expect(outcome.subject.template).toBe('新的标题')
    await expect(saveRuleAccount(area, origin, userA, rules(), null)).rejects.toThrow('发文规则已被其他页面更新')
  })

  it('rejects a page-forged file through the workspace bridge and keeps writes closed', async () => {
    const tabs = [{ id: 3, url: `${origin}/inbox`, title: 'EASY' }]
    const runtime: WorkspaceHost = {
      connection: new EasyConnectionController(),
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
      sendToTab: async (_tabId, message) => {
        if (message.type === MessageType.SearchFiles) {
          const pageIndex = message.payload.query.pageIndex
          return {
            type: MessageType.SearchFilesResult,
            payload: { ok: true, data: page([patent(pageIndex === 1 ? 'A' : 'C', '客户甲', '专利证书')], pageIndex) }
          }
        }
        return { type: MessageType.SessionResult, payload: { ok: true, data: { status: 'authenticated', userId: userA, displayName: '测试员', checkedAt: '2026-09-26T00:00:00.000Z' } } }
      }
    }
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
    if (bound.type !== MessageType.WorkspaceResult || !bound.payload.ok) throw new Error('bind')
    const scope = scopeFromConnection(runtime.connection.context)
    if (!scope) throw new Error('scope')
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveRules', bundle: rules(), expectedScope: scope } }, runtime)
    await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'saveCustomer', profile: profile(), expectedScope: scope } }, runtime)
    const query = { caseVolume: 'Q1', pageIndex: 1, pageSize: 20 }
    const first = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'forward', message: { type: MessageType.SearchFiles, payload: { query } } } }, runtime)
    if (first.type !== MessageType.WorkspaceResult || !first.payload.forwarded || first.payload.forwarded.type !== MessageType.SearchFilesResult || !first.payload.forwarded.payload.ok) throw new Error('search')
    const sessionId = first.payload.forwarded.payload.data.querySessionId
    if (!sessionId) throw new Error('session')
    const second = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'forward', message: { type: MessageType.SearchFiles, payload: { query: { ...query, pageIndex: 2 }, continuation: { querySessionId: sessionId } } } } }, runtime)
    if (second.type !== MessageType.WorkspaceResult || !second.payload.ok) throw new Error('page')
    const planned = await handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: {
        action: 'createTaskPlan',
        queryTemplateVersion: 0,
        expectedScope: scope,
        files: [
          { ...file('A', '客户乙', '审查意见通知书'), querySessionId: sessionId, fileDescriptionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', customerId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', caseId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
          { ...file('C'), querySessionId: sessionId }
        ]
      }
    }, runtime)
    if (planned.type !== MessageType.WorkspaceResult) throw new Error('plan')
    expect(planned.payload.ok).toBe(true)
    const stored = await runtime.tasks?.list(origin, userA)
    const rebuilt = stored?.[0]?.selectedFiles.find(item => item.fileId === 'A')
    expect(rebuilt?.customerName).toBe('客户甲')
    expect(rebuilt?.fileDescription).toBe('专利证书')
    expect(rebuilt?.fileDescriptionId).toBeUndefined()
    expect(rebuilt?.customerId).toBeUndefined()
    expect(rebuilt?.caseId).toBeUndefined()
    expect(stored?.[0]?.verifiedSelection?.map(item => item.verification)).toEqual(['SEARCH_RESPONSE_OBSERVED', 'SEARCH_RESPONSE_OBSERVED'])
    expect(stored?.[0]?.fileSource).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(stored?.[0]?.status).toBe('BLOCKED')
    const checked = validateTask(stored?.[0] ?? buildTask({ origin, operatorId: userA, files: [file('A')], rules: rules(), profiles: [profile()], queryTemplateVersion: 0 }), {
      origin, operatorId: userA, files: stored?.[0]?.selectedFiles ?? [], rules: rules(), profiles: [profile()], templates: [template()], queryTemplateVersion: 0
    })
    expect(checked.fileSource).not.toBe('FILE_READBACK_VERIFIED')
    expect(EASY_MAIL_WRITES_ENABLED).toBe(false)
    expect(WORKFLOW_WRITES_ENABLED).toBe(false)
  })
})
