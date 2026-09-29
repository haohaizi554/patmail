import { beforeEach, describe, expect, it } from 'vitest'
import { handleAuthorityMessage } from '../src/background/authority'
import { evaluateCurrentTaskEvidence, evaluateTaskEvidence } from '../src/automation/evidence-evaluation'
import { buildStagePlans } from '../src/automation/stage-plan'
import { buildTask } from '../src/automation/task-builder'
import { validateTask } from '../src/automation/task-validator'
import {
  clearQuerySessionStore,
  dropQuerySessionMemory,
  liveQuerySessions,
  observeSearchPage,
  resolveSelectedFiles,
  useQuerySessionDisk,
  type FileQuerySession,
  type QueryDisk
} from '../src/automation/file-search-snapshot'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import type { ExecutionLedger } from '../src/automation/ledger'
import type { TaskStore } from '../src/automation/task-service'
import { emptyMailRules } from '../src/mail'
import { mailWritesEnabled } from '../src/mail/easy/gate'
import { productionWriteAllowed } from '../src/automation/contract-capture'
import { workflowWritesEnabled } from '../src/workflow/gate'
import { MessageType } from '../src/shared/message'
import type { FileSearchResult, PatentFile } from '../src/api/file-search-types'
import type { SelectedPatentFile } from '../src/mail/types'
import type { AutomationTask, VerifiedSelectionSnapshot } from '../src/automation/types'

const origin = 'http://183.36.43.66:88'
const scope = { easyOrigin: origin, operatorId: 'aaaaaaaa-1111-4111-8111-111111111111', easyTabId: 3, connectionVersion: 1 }
const account = { easyOrigin: origin, operatorId: scope.operatorId, easyTabId: scope.easyTabId, connectionVersion: scope.connectionVersion }
const t0 = '2026-09-26T08:00:00.000Z'
const created = '2026-09-26T08:05:00.000Z'
const later = '2026-09-26T08:10:00.000Z'

function patent(fileId: string, description = '专利证书', customer = '客户甲'): PatentFile {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription: description, customerName: customer, caseVolume: 'V1', caseId: 'case-1' }
}
function result(items: PatentFile[], pageIndex = 1): FileSearchResult {
  return { items, total: items.length, pageIndex, pageSize: 20, totalPages: 1 }
}
function selected(fileId: string, sessionId: string, description = '专利证书'): SelectedPatentFile {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription: description, customerName: '客户甲', caseVolume: 'V1', caseId: 'case-1', querySessionId: sessionId }
}
function query(pageIndex = 1) {
  return { caseVolume: 'Q', pageIndex, pageSize: 20 }
}
function committedDisk(): QueryDisk & { records: Map<string, FileQuerySession> } {
  const records = new Map<string, FileQuerySession>()
  return {
    records,
    async put(id, session) { records.set(id, structuredClone(session)); return 'PERSISTED' },
    async get(id) { const found = records.get(id); return found ? structuredClone(found) : null },
    async all() { return [...records.values()].map(item => structuredClone(item)) },
    async delete(id) { return records.delete(id) ? 'DELETED' : 'NOT_FOUND' }
  }
}
function snap(fileId: string, extra: Partial<VerifiedSelectionSnapshot> = {}): VerifiedSelectionSnapshot {
  return {
    fileId, querySource: 'FILE_SEARCH_PAGE', customerProfileId: '', fileDescription: '专利证书',
    fileName: `${fileId}.pdf`, sourceCustomerName: '客户甲', caseVolume: 'V1', caseId: 'case-1',
    fetchedAt: t0, easyOrigin: origin, operatorId: scope.operatorId, verification: 'SEARCH_RESPONSE_OBSERVED',
    querySessionId: '11111111-1111-4111-8111-111111111111', historicalObservation: true,
    persistence: 'PERSISTED', evidenceExpiresAt: '2026-09-26T08:30:00.000Z', recoveryState: 'CURRENT',
    ...extra
  }
}
function taskFrom(selections: VerifiedSelectionSnapshot[]): AutomationTask {
  return buildTask({
    origin, operatorId: scope.operatorId,
    files: selections.map(item => ({ fileId: item.fileId, fileName: item.fileName || item.fileId, fileDescription: item.fileDescription, customerName: item.sourceCustomerName || '', querySessionId: item.querySessionId })),
    rules: emptyMailRules(scope.operatorId), profiles: [], queryTemplateVersion: 0, verifiedSelection: selections, now: created
  })
}

beforeEach(async () => {
  await clearQuerySessionStore()
})

describe('Phase 3.9 当前来源与证据聚合', () => {
  it('does not keep a removed file trusted on an already saved task', async () => {
    useQuerySessionDisk(committedDisk())
    const first = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const resolved = await resolveSelectedFiles([selected('A', first.session.querySessionId)], scope, { now: created })
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now: created
    })
    const fetchedAt = task.verifiedSelection?.[0]?.fetchedAt
    const second = await observeSearchPage({
      scope, query: query(), result: result([patent('B')]), observedAt: later,
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    const snapshot = evaluateTaskEvidence(task, account, later)
    const current = await evaluateCurrentTaskEvidence(task, account, liveQuerySessions(), later)
    expect(snapshot.freshness).toBe('FRESH')
    expect(current.reason).toBe('FILE_REMOVED')
    expect(current.currentTrust).toBe(false)
    expect(current.requiresRevalidation).toBe(true)
    expect(current.message).toContain('不再包含')
    expect(task.verifiedSelection?.[0]?.fetchedAt).toBe(fetchedAt)
    expect(current.files[0]?.historical.fetchedAt).toBe(fetchedAt)
    const reviewed = validateTask(task, {
      origin, operatorId: scope.operatorId, files: task.selectedFiles, rules: task.ruleSnapshot, profiles: [], queryTemplateVersion: 0, now: later
    }, current)
    expect(reviewed.status).toBe('STALE')
    expect(reviewed.issues.some(item => item.code === 'CURRENT_EVIDENCE_INVALID')).toBe(true)
    expect(reviewed.verifiedSelection?.[0]?.fetchedAt).toBe(fetchedAt)
    const plans = buildStagePlans(task, 'UNKNOWN', { now: later, currentAccount: account, currentEvidenceState: current })
    expect(plans.find(item => item.stage === 'MAIL_CREATE')?.canExecute).toBe(false)
    expect(plans.find(item => item.stage === 'FILE_QUERY')?.canExecute).toBe(true)
  })

  it('does not revoke an unchanged file when another page is added', async () => {
    useQuerySessionDisk(committedDisk())
    const first = await observeSearchPage({ scope, query: query(1), result: result([patent('A')], 1), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const resolved = await resolveSelectedFiles([selected('A', first.session.querySessionId)], scope, { now: created })
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now: created
    })
    const second = await observeSearchPage({
      scope, query: query(2), result: result([patent('B')], 2), observedAt: later,
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.session.recordVersion).toBeGreaterThan(1)
    const current = await evaluateCurrentTaskEvidence(task, account, liveQuerySessions(), later)
    expect(current.files[0]?.reason).toBe('CURRENT_VERIFIED')
    expect(current.currentTrust).toBe(true)
    expect(current.requiresRevalidation).toBe(false)
  })

  it('requires revalidation when the same file id changes description or customer', async () => {
    useQuerySessionDisk(committedDisk())
    const first = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const resolved = await resolveSelectedFiles([selected('A', first.session.querySessionId)], scope, { now: created })
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now: created
    })
    const changed = await observeSearchPage({
      scope, query: query(), result: result([patent('A', '审查意见通知书', '客户乙')]), observedAt: later,
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!changed.ok) throw new Error(changed.reason)
    const current = await evaluateCurrentTaskEvidence(task, account, liveQuerySessions(), later)
    expect(current.reason).toBe('FILE_FIELDS_CHANGED')
    expect(current.currentTrust).toBe(false)
    expect(task.verifiedSelection?.[0]?.fileDescription).toBe('专利证书')
  })

  it('keeps a restarted disk record as history until the user queries again', async () => {
    useQuerySessionDisk(committedDisk())
    const saved = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: t0 })
    if (!saved.ok) throw new Error(saved.reason)
    const resolved = await resolveSelectedFiles([selected('A', saved.session.querySessionId)], scope, { now: created })
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now: created
    })
    dropQuerySessionMemory()
    const current = await evaluateCurrentTaskEvidence(task, account, liveQuerySessions(), later)
    expect(current.reason).toBe('RECOVERED_PENDING_REVALIDATION')
    expect(current.currentTrust).toBe(false)
    expect(current.recoverability).toBe('RESTORABLE')
    expect(current.requiresRevalidation).toBe(true)
  })

  it('does not aggregate a missing persistence value into PERSISTED', () => {
    const missing = snap('B')
    delete (missing as { persistence?: string }).persistence
    const task = taskFrom([snap('A'), missing])
    expect(task.identityGate?.persistence).toBe('UNKNOWN')
    expect(task.identityGate?.evidenceRestorable).toBe(false)
    const evidence = evaluateTaskEvidence(task, account, later)
    expect(evidence.persistence).toBe('UNKNOWN')
    expect(evidence.currentTrust).toBe(false)
    expect(evidence.requiresRevalidation).toBe(true)
  })

  it('does not treat a missing or invalid evidence time as fresh', () => {
    const now = later
    const missingTime = snap('B')
    delete (missingTime as { evidenceExpiresAt?: string }).evidenceExpiresAt
    const missing = evaluateTaskEvidence(taskFrom([snap('A'), missingTime]), account, now)
    expect(missing.freshness).toBe('UNKNOWN')
    expect(missing.requiresRevalidation).toBe(true)
    const invalid = evaluateTaskEvidence(taskFrom([snap('A'), snap('B', { evidenceExpiresAt: '昨天' })]), account, now)
    expect(invalid.freshness).toBe('UNKNOWN')
    expect(invalid.requiresRevalidation).toBe(true)
    const expired = evaluateTaskEvidence(taskFrom([snap('A'), snap('B', { evidenceExpiresAt: '2026-09-26T08:01:00.000Z' })]), account, now)
    expect(expired.freshness).toBe('EXPIRED')
    expect(expired.requiresRevalidation).toBe(true)
    const fresh = evaluateTaskEvidence(taskFrom([snap('A'), snap('B')]), account, now)
    expect(fresh.freshness).toBe('FRESH')
    expect(fresh.currentTrust).toBe(true)
    const blank = evaluateTaskEvidence(taskFrom([snap('A', { evidenceExpiresAt: undefined }), snap('B', { evidenceExpiresAt: undefined })]), account, now)
    expect(blank.freshness).toBe('UNKNOWN')
    const legacy = taskFrom([snap('A')])
    delete legacy.verifiedSelection
    const old = evaluateTaskEvidence(legacy, account, now)
    expect(old.freshness).toBe('UNKNOWN')
    expect(old.requiresRevalidation).toBe(false)
    expect(old.currentTrust).toBe(false)
  })

  it('keeps checkpoints when a sent task loses its current file source', async () => {
    useQuerySessionDisk(committedDisk())
    const first = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const resolved = await resolveSelectedFiles([selected('A', first.session.querySessionId)], scope, { now: created })
    const built = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now: created
    })
    const mailId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const task: AutomationTask = {
      ...built,
      status: 'UNKNOWN',
      readonly: true,
      checkpoints: [{ stage: 'MAIL_CREATE', itemId: '', requestSent: true, responseReceived: false, verified: false, easyMailId: mailId, at: created, note: 'sent' }],
      items: built.items.map(item => ({ ...item, easyMailId: mailId }))
    }
    await observeSearchPage({
      scope, query: query(), result: result([patent('B')]), observedAt: later,
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    const current = await evaluateCurrentTaskEvidence(task, account, liveQuerySessions(), later)
    const reviewed = validateTask(task, {
      origin, operatorId: scope.operatorId, files: task.selectedFiles, rules: task.ruleSnapshot, profiles: [], queryTemplateVersion: 0, now: later
    }, current)
    expect(reviewed.status).toBe('UNKNOWN')
    expect(reviewed.checkpoints).toEqual(task.checkpoints)
    expect(reviewed.items[0]?.easyMailId).toBe(mailId)
    expect(reviewed.issues.some(item => item.code === 'CURRENT_EVIDENCE_INVALID')).toBe(true)
    expect(mailWritesEnabled() && workflowWritesEnabled() && productionWriteAllowed()).toBe(true)
  })

  it('lets the background recompute trust instead of accepting a page-supplied verdict', async () => {
    useQuerySessionDisk(committedDisk())
    const now = new Date().toISOString()
    const first = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: now })
    if (!first.ok) throw new Error(first.reason)
    const resolved = await resolveSelectedFiles([selected('A', first.session.querySessionId)], scope, { now })
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now
    })
    await observeSearchPage({
      scope, query: query(), result: result([patent('B')]),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    const forged = { ...task, currentTrust: true, reason: 'CURRENT_VERIFIED' }
    const store: TaskStore = {
      async list() { return [forged] },
      async save() { return { ok: false, code: 'INVALID_TRANSITION', message: '不保存' } },
      async updateTaskAtomically() { return { ok: false, code: 'INVALID_TRANSITION', message: '不保存' } },
      async archive() { return { ok: false, message: '' } }
    }
    const response = await handleAuthorityMessage({
      type: MessageType.GetTask,
      payload: { origin, operatorId: scope.operatorId, taskId: task.taskId }
    }, { ledger: {} as ExecutionLedger, tasks: store, evidence: new MemoryEvidenceStore(), account })
    expect(response?.type).toBe(MessageType.TaskResult)
    if (response?.type !== MessageType.TaskResult) return
    const evidence = response.payload.currentEvidence as { reason?: string; currentTrust?: boolean } | undefined
    expect(evidence?.reason).toBe('FILE_REMOVED')
    expect(evidence?.currentTrust).toBe(false)
    const plans = response.payload.stagePlans as Array<{ stage?: string; canExecute?: boolean; sideEffect?: string }> | undefined
    expect(plans?.find(item => item.stage === 'MAIL_SAVE')?.canExecute).toBe(false)
    expect(plans?.filter(item => item.sideEffect === 'write').every(item => item.canExecute === false)).toBe(true)
  })
})
