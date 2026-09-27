import { beforeEach, describe, expect, it } from 'vitest'
import { buildTask } from '../src/automation/task-builder'
import { buildStagePlans } from '../src/automation/stage-plan'
import { evaluateTaskEvidence } from '../src/automation/evidence-evaluation'
import {
  clearQuerySessionStore,
  dropQuerySessionMemory,
  observeSearchPage,
  resolveSelectedFiles,
  useQuerySessionDisk,
  type FileQuerySession,
  type QueryDisk
} from '../src/automation/file-search-snapshot'
import { emptyMailRules } from '../src/mail'
import { EASY_MAIL_WRITES_ENABLED } from '../src/mail/easy/gate'
import { WORKFLOW_WRITES_ENABLED } from '../src/workflow/gate'
import { productionWriteAllowed } from '../src/automation/contract-capture'
import type { FileSearchResult, PatentFile } from '../src/api/file-search-types'
import type { SelectedPatentFile } from '../src/mail/types'

const origin = 'http://183.36.43.66:88'
const scope = { easyOrigin: origin, operatorId: 'aaaaaaaa-1111-4111-8111-111111111111', easyTabId: 3, connectionVersion: 1 }

function patent(fileId: string): PatentFile {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription: '专利证书', customerName: '客户甲', caseVolume: 'V1' }
}
function result(items: PatentFile[], pageIndex = 1): FileSearchResult {
  return { items, total: items.length, pageIndex, pageSize: 20, totalPages: 1 }
}
function selected(fileId: string, sessionId: string): SelectedPatentFile {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription: '专利证书', customerName: '客户甲', querySessionId: sessionId }
}
function query(pageIndex = 1) {
  return { caseVolume: 'Q', pageIndex, pageSize: 20 }
}

function stuckDisk(): QueryDisk & { records: Map<string, FileQuerySession> } {
  const records = new Map<string, FileQuerySession>()
  let writes = 0
  return {
    records,
    async put(id, session) {
      writes += 1
      if (writes === 1) {
        records.set(id, structuredClone(session))
        return 'PERSISTED'
      }
      return 'FAILED'
    },
    async get(id) {
      const found = records.get(id)
      return found ? structuredClone(found) : null
    },
    async all() { return [...records.values()].map(item => structuredClone(item)) },
    async delete() { return 'FAILED' }
  }
}

beforeEach(async () => {
  await clearQuerySessionStore()
})

describe('Phase 3.8 恢复与证据时间', () => {
  it('does not trust file A after a failed page update leaves the old disk record', async () => {
    const disk = stuckDisk()
    useQuerySessionDisk(disk)
    const first = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!first.ok) throw new Error(first.reason)
    expect(first.persistence).toBe('PERSISTED')
    expect(first.session.recordVersion).toBe(1)
    const second = await observeSearchPage({
      scope,
      query: query(),
      result: result([patent('B')]),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.session.files.map(item => item.fileId)).toEqual(['B'])
    expect(second.session.recordVersion).toBe(2)
    expect(second.session.revocationDiagnostic).toBe('磁盘上的旧查询记录未能删除，不能视为已撤销。')
    expect(disk.records.get(first.session.querySessionId)?.files.map(item => item.fileId)).toEqual(['A'])
    expect(disk.records.get(first.session.querySessionId)?.recordVersion).toBe(1)
    dropQuerySessionMemory()
    const revived = await resolveSelectedFiles([selected('A', first.session.querySessionId)], scope)
    expect(revived.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(revived.selections[0]?.historicalObservation).toBe(true)
    expect(revived.selections[0]?.recoveryState).toBe('RECOVERED_PENDING_REVALIDATION')
    expect(revived.requiresRevalidation).toBe(true)
  })

  it('restores a saved session after restart only as history', async () => {
    const records = new Map<string, FileQuerySession>()
    useQuerySessionDisk({
      async put(id, session) { records.set(id, structuredClone(session)); return 'PERSISTED' },
      async get(id) { const found = records.get(id); return found ? structuredClone(found) : null },
      async all() { return [...records.values()].map(item => structuredClone(item)) },
      async delete(id) { return records.delete(id) ? 'DELETED' : 'NOT_FOUND' }
    })
    const saved = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.persistence).toBe('PERSISTED')
    const live = await resolveSelectedFiles([selected('A', saved.session.querySessionId)], scope)
    expect(live.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    dropQuerySessionMemory()
    const recovered = await resolveSelectedFiles([selected('A', saved.session.querySessionId)], scope)
    expect(recovered.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(recovered.selections[0]?.historicalObservation).toBe(true)
    expect(recovered.selections[0]?.fetchedAt).toBe(live.selections[0]?.fetchedAt)
  })

  it('does not call a memory map a persisted database when IndexedDB is missing', async () => {
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!observed.ok) throw new Error(observed.reason)
    if (typeof indexedDB === 'undefined') {
      expect(observed.persistence).toBe('MEMORY_ONLY')
      const preview = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
      expect(preview.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
      dropQuerySessionMemory()
      const gone = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
      expect(gone.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
      return
    }
    expect(observed.persistence).toBe('PERSISTED')
    dropQuerySessionMemory()
    const recovered = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(recovered.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(recovered.selections[0]?.historicalObservation).toBe(true)
  })

  it('does not upgrade an old stored record that never recorded persistence', async () => {
    const disk = stuckDisk()
    useQuerySessionDisk(disk)
    const saved = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!saved.ok) throw new Error(saved.reason)
    const raw = disk.records.get(saved.session.querySessionId)
    if (!raw) throw new Error('missing')
    const legacy = { ...raw } as FileQuerySession
    delete (legacy as { persistence?: string }).persistence
    delete (legacy as { recoveryState?: string }).recoveryState
    useQuerySessionDisk({
      async put() { return 'FAILED' },
      async get() { return legacy },
      async all() { return [legacy] },
      async delete() { return 'NOT_FOUND' }
    })
    dropQuerySessionMemory()
    const resolved = await resolveSelectedFiles([selected('A', saved.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(resolved.selections[0]?.persistence).not.toBe('PERSISTED')
  })

  it('expires task evidence at reopen without changing the original observation time', async () => {
    const t0 = '2026-09-26T08:00:00.000Z'
    const created = '2026-09-26T08:05:00.000Z'
    const reopen = '2026-09-26T08:35:00.000Z'
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: t0 })
    if (!observed.ok) throw new Error(observed.reason)
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope, { now: created })
    const fetchedAt = resolved.selections[0]?.fetchedAt
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections, now: created
    })
    const early = evaluateTaskEvidence(task, { easyOrigin: origin, operatorId: scope.operatorId }, created)
    const late = evaluateTaskEvidence(task, { easyOrigin: origin, operatorId: scope.operatorId }, reopen)
    expect(early.freshness).toBe('FRESH')
    expect(early.historicalObservation).toBe(true)
    expect(late.freshness).toBe('EXPIRED')
    expect(late.requiresRevalidation).toBe(true)
    expect(late.message).toBe('查询证据已过期，请重新查询。')
    expect(task.verifiedSelection?.[0]?.fetchedAt).toBe(fetchedAt)
    const plans = buildStagePlans(task, 'UNKNOWN', { now: reopen, currentAccount: { easyOrigin: origin, operatorId: scope.operatorId } })
    expect(plans.find(item => item.stage === 'DRAFT_VALIDATE')?.canExecute).toBe(false)
    expect(plans.find(item => item.stage === 'FILE_QUERY')?.canExecute).toBe(true)
    expect(plans.filter(item => item.sideEffect === 'write').every(item => item.canExecute === false)).toBe(true)
    expect(plans.find(item => item.stage === 'MAIL_SAVE')?.blockers.some(item => item.includes('重新查询') || item.includes('客户 GUID'))).toBe(true)
  })

  it('keeps a newer page valid after an older page of another file expires', async () => {
    const t0 = '2026-09-26T08:00:00.000Z'
    const t25 = '2026-09-26T08:25:00.000Z'
    const t35 = '2026-09-26T08:35:00.000Z'
    const first = await observeSearchPage({ scope, query: query(1), result: result([patent('A')], 1), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope, query: query(2), result: result([patent('B')], 2), observedAt: t25,
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    const resolved = await resolveSelectedFiles(
      [selected('A', second.session.querySessionId), selected('B', second.session.querySessionId)],
      scope,
      { now: t35 }
    )
    expect(resolved.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(resolved.selections[1]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
  })

  it('accepts a new query after the previous evidence expired', async () => {
    const t0 = '2026-09-26T08:00:00.000Z'
    const again = '2026-09-26T09:00:00.000Z'
    const first = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const next = await observeSearchPage({ scope, query: query(), result: result([patent('A')]), observedAt: again })
    if (!next.ok) throw new Error(next.reason)
    expect(next.session.querySessionId).not.toBe(first.session.querySessionId)
    const resolved = await resolveSelectedFiles([selected('A', next.session.querySessionId)], scope, { now: again })
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(resolved.selections[0]?.fetchedAt).toBe(again)
  })

  it('keeps write stages closed when customer and description ids are unconfirmed', async () => {
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!observed.ok) throw new Error(observed.reason)
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections
    })
    const plans = buildStagePlans(task)
    expect(task.identityGate?.customerIdsVerified).toBe(false)
    expect(task.identityGate?.descriptionIdsVerified).toBe(false)
    expect(plans.find(item => item.stage === 'MAIL_CREATE')?.canExecute).toBe(false)
    expect(plans.find(item => item.stage === 'MAIL_SAVE')?.canExecute).toBe(false)
    expect(plans.find(item => item.stage === 'DESCRIPTION_MAPPING')?.canExecute).toBe(false)
    expect(EASY_MAIL_WRITES_ENABLED).toBe(false)
    expect(WORKFLOW_WRITES_ENABLED).toBe(false)
    expect(productionWriteAllowed()).toBe(false)
  })
})
