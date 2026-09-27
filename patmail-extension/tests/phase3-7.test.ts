import { beforeEach, describe, expect, it } from 'vitest'
import { buildFileTypeTree } from '../src/schema/file-type-tree'
import { resolveFileDescriptionIdentity } from '../src/automation/file-description-resolver'
import {
  clearQuerySessionStore,
  dropQuerySessionMemory,
  observeSearchPage,
  resolveSelectedFiles,
  useQuerySessionDisk
} from '../src/automation/file-search-snapshot'
import { buildTask } from '../src/automation/task-builder'
import { buildStagePlans } from '../src/automation/stage-plan'
import { emptyMailRules } from '../src/mail'
import { EASY_MAIL_WRITES_ENABLED } from '../src/mail/easy/gate'
import { WORKFLOW_WRITES_ENABLED } from '../src/workflow/gate'
import { productionWriteAllowed } from '../src/automation/contract-capture'
import type { FileSearchResult, PatentFile } from '../src/api/file-search-types'
import type { SelectedPatentFile } from '../src/mail/types'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const scope = { easyOrigin: origin, operatorId: guid('aaaaaaaa'), easyTabId: 3, connectionVersion: 1 }
const descriptionId = guid('dddddddd')
const caseType = guid('cccccccc')

function patent(fileId: string, fileDescription = '专利证书', customerName = '客户甲'): PatentFile {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription, customerName, caseVolume: 'V1' }
}
function result(items: PatentFile[], pageIndex = 1): FileSearchResult {
  return { items, total: items.length, pageIndex, pageSize: 20, totalPages: 1 }
}
function selected(fileId: string, sessionId: string, fileDescription = '专利证书'): SelectedPatentFile {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription, customerName: '客户甲', querySessionId: sessionId }
}
function query(pageIndex = 1) {
  return { caseVolume: 'Q', pageIndex, pageSize: 20 }
}

beforeEach(async () => {
  await clearQuerySessionStore()
})

describe('Phase 3.7 查询证据', () => {
  it('dedupes the same id when the business fields agree', async () => {
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A'), patent('A')]) })
    if (!observed.ok) throw new Error(observed.reason)
    expect(observed.session.status).toBe('ACTIVE')
    expect(observed.session.files).toHaveLength(1)
    expect(observed.session.files[0]?.conflict).toBe(false)
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
  })

  it('keeps a same-page description conflict and withholds observed trust', async () => {
    const observed = await observeSearchPage({
      scope,
      query: query(),
      result: result([patent('A', '专利证书'), patent('A', '审查意见通知书')])
    })
    if (!observed.ok) throw new Error(observed.reason)
    expect(observed.session.status).toBe('CONFLICT')
    expect(observed.session.files.find(item => item.fileId === 'A')?.conflict).toBe(true)
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(resolved.issue).toBe('FILE_DATA_CONFLICT')
  })

  it('keeps a same-page customer conflict', async () => {
    const observed = await observeSearchPage({
      scope,
      query: query(),
      result: result([patent('A', '专利证书', '客户甲'), patent('A', '专利证书', '客户乙')])
    })
    if (!observed.ok) throw new Error(observed.reason)
    expect(observed.session.status).toBe('CONFLICT')
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(resolved.issue).toBe('FILE_DATA_CONFLICT')
    expect(resolved.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('accepts the same file on another page when the fields agree', async () => {
    const first = await observeSearchPage({ scope, query: query(1), result: result([patent('A')], 1) })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope,
      query: query(2),
      result: result([patent('A')], 2),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.session.status).toBe('ACTIVE')
    const resolved = await resolveSelectedFiles([selected('A', second.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
  })

  it('conflicts when another page disagrees', async () => {
    const first = await observeSearchPage({ scope, query: query(1), result: result([patent('A', '专利证书')], 1) })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope,
      query: query(2),
      result: result([patent('A', '审查意见通知书')], 2),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.session.status).toBe('CONFLICT')
    const resolved = await resolveSelectedFiles([selected('A', second.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('recomputes after a later page snapshot removes the disagreement', async () => {
    const first = await observeSearchPage({
      scope,
      query: query(),
      result: result([patent('A', '专利证书'), patent('A', '审查意见通知书')])
    })
    if (!first.ok) throw new Error(first.reason)
    const next = await observeSearchPage({
      scope,
      query: query(),
      result: result([patent('A', '专利证书')]),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!next.ok) throw new Error(next.reason)
    expect(next.session.status).toBe('ACTIVE')
    expect(next.session.files[0]?.conflict).toBe(false)
    const resolved = await resolveSelectedFiles([selected('A', next.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(resolved.issue).toBeUndefined()
  })

  it('does not extend an older page just because a later page is read', async () => {
    const t0 = '2026-09-26T08:00:00.000Z'
    const laterPage = '2026-09-26T08:25:00.000Z'
    const selectAt = '2026-09-26T08:35:00.000Z'
    const first = await observeSearchPage({ scope, query: query(1), result: result([patent('A')], 1), observedAt: t0 })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope,
      query: query(2),
      result: result([patent('B')], 2),
      observedAt: laterPage,
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.session.pages.find(page => page.pageIndex === 1)?.evidenceExpiresAt).toBe('2026-09-26T08:30:00.000Z')
    expect(Date.parse(second.session.expiresAt)).toBeGreaterThan(Date.parse(selectAt))
    const stale = await resolveSelectedFiles([selected('A', second.session.querySessionId)], scope, { now: selectAt })
    const fresh = await resolveSelectedFiles([selected('B', second.session.querySessionId, '专利证书')], scope, { now: selectAt })
    expect(stale.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
    expect(fresh.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(fresh.selections[0]?.persistence).toBe('PERSISTED')
  })

  it('keeps the observation when the record is only in memory, and does not treat it as recoverable', async () => {
    useQuerySessionDisk('unavailable')
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!observed.ok) throw new Error(observed.reason)
    expect(observed.persistence).toBe('MEMORY_ONLY')
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(resolved.selections[0]?.persistence).toBe('MEMORY_ONLY')
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections
    })
    expect(task.identityGate?.persistence).toBe('MEMORY_ONLY')
    expect(task.identityGate?.evidenceRestorable).toBe(false)
    const plans = buildStagePlans(task)
    expect(plans.find(item => item.stage === 'MAIL_CREATE')?.canExecute).toBe(false)
    expect(plans.find(item => item.stage === 'MAIL_CREATE')?.blockers.some(item => item.includes('重新核验'))).toBe(true)
    dropQuerySessionMemory()
    const gone = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(gone.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('records a failed save without hiding the current observation', async () => {
    useQuerySessionDisk({
      async put() { return 'FAILED' },
      async get() { return null },
      async all() { return [] },
      async delete() { return undefined }
    })
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!observed.ok) throw new Error(observed.reason)
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope)
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(resolved.selections[0]?.persistence).toBe('FAILED')
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections
    })
    expect(task.identityGate?.persistence).toBe('FAILED')
    expect(task.identityGate?.evidenceRestorable).toBe(false)
    if (task.status === 'BLOCKED') {
      const plans = buildStagePlans(task)
      expect(plans.find(item => item.stage === 'DRAFT_VALIDATE')?.canExecute).toBe(false)
      expect(plans.find(item => item.stage === 'FILE_QUERY')?.canExecute).toBe(true)
      expect(plans.find(item => item.stage === 'MAIL_SAVE')?.canExecute).toBe(false)
    }
  })

  it('rejects an unknown continuation instead of keeping the old run', async () => {
    const started = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!started.ok) throw new Error(started.reason)
    const continued = await observeSearchPage({
      scope,
      query: query(2),
      result: result([patent('B')], 2),
      run: { mode: 'continue', querySessionId: '00000000-0000-4000-8000-000000000099' }
    })
    expect(continued.ok).toBe(false)
    if (!continued.ok) expect(continued.code).toBe('QUERY_SESSION_INVALID')
    const still = await resolveSelectedFiles([selected('A', started.session.querySessionId)], scope)
    expect(still.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
  })

  it('does not promote a unique dictionary name into a verified mail parameter', () => {
    const built = buildFileTypeTree([{ id: descriptionId, name: '专利证书', pid: '', seq: 1, TreeType: 'User', tree_level: 1 }])
    expect(built.nodes[0]?.treeType).toBe('User')
    expect(built.nodes[0]?.selectable).toBeUndefined()
    expect(resolveFileDescriptionIdentity('专利证书', built.nodes, caseType)).toEqual({
      fileDescriptionId: descriptionId, verified: false, selectable: 'pending'
    })
    const parentId = guid('eeeeeeee')
    const parent = resolveFileDescriptionIdentity('分类', [{
      id: parentId, name: '分类', parentId: '', order: 1, childIds: [descriptionId], selectable: true
    }], caseType)
    expect(parent).toEqual({ fileDescriptionId: parentId, verified: false, selectable: 'pending' })
    const confirmed = resolveFileDescriptionIdentity('专利证书', [{
      id: descriptionId, name: '专利证书', parentId: '', order: 1, childIds: [], selectable: true
    }], caseType)
    expect(confirmed).toEqual({ fileDescriptionId: descriptionId, verified: true, selectable: 'confirmed' })
  })

  it('blocks write stages when the customer guid and description id are not verified', async () => {
    const observed = await observeSearchPage({ scope, query: query(), result: result([patent('A')]) })
    if (!observed.ok) throw new Error(observed.reason)
    const resolved = await resolveSelectedFiles([selected('A', observed.session.querySessionId)], scope, {
      caseTypeId: caseType,
      descriptionNodes: [{ id: descriptionId, name: '专利证书', parentId: '', order: 1, childIds: [] }]
    })
    const task = buildTask({
      origin, operatorId: scope.operatorId, files: resolved.files, rules: emptyMailRules(scope.operatorId),
      profiles: [], queryTemplateVersion: 0, verifiedSelection: resolved.selections
    })
    expect(task.identityGate?.descriptionIdsVerified).toBe(false)
    expect(task.identityGate?.customerIdsVerified).toBe(false)
    const plans = buildStagePlans(task)
    expect(plans.find(item => item.stage === 'DESCRIPTION_MAPPING')?.blockers.some(item => item.includes('文件描述内部 ID'))).toBe(true)
    expect(plans.find(item => item.stage === 'MAIL_CREATE')?.canExecute).toBe(false)
    expect(plans.find(item => item.stage === 'MAIL_SAVE')?.blockers.some(item => item.includes('客户 GUID'))).toBe(true)
    expect(plans.filter(item => item.sideEffect === 'write').every(item => item.canExecute === false)).toBe(true)
    expect(EASY_MAIL_WRITES_ENABLED).toBe(false)
    expect(WORKFLOW_WRITES_ENABLED).toBe(false)
    expect(productionWriteAllowed()).toBe(false)
  })
})
