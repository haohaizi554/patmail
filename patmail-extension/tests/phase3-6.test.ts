import { beforeEach, describe, expect, it } from 'vitest'
import { clearFileTypeTrees, rememberFileTypeTree, resolveFileDescriptionIdentity } from '../src/automation/file-description-resolver'
import {
  clearQuerySessionStore,
  dropQuerySessionMemory,
  observeSearchPage,
  resolveSelectedFiles,
  sessionsFor,
  useQuerySessionDisk,
  type QueryDisk
} from '../src/automation/file-search-snapshot'
import { handleWorkspaceMessage, type WorkspaceHost } from '../src/background/workspace'
import { MemoryEvidenceStore } from '../src/automation/evidence-store'
import { SerialTaskStore } from '../src/automation/indexed-store'
import type { FileSearchResult } from '../src/api/file-search-types'
import type { CustomerQueryProfile } from '../src/customer/types'
import type { SelectedPatentFile } from '../src/mail/types'
import { EasyConnectionController } from '../src/shared/connection'
import { MessageType } from '../src/shared/message'

const origin = 'http://183.36.43.66:88'
const userA = 'aaaaaaaa-1111-4111-8111-111111111111'
const userB = 'bbbbbbbb-1111-4111-8111-111111111111'
const scopeA = { easyOrigin: origin, operatorId: userA, easyTabId: 3, connectionVersion: 1 }
const scopeB = { ...scopeA, operatorId: userB }
const caseType = 'cccccccc-1111-4111-8111-111111111111'
const descriptionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const forgedDescription = 'abababab-abab-4aba-8aba-abababababab'
const forgedCustomer = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const forgedCase = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function page(items: FileSearchResult['items'], pageIndex: number, pageSize = 20): FileSearchResult {
  return { items, total: 40, pageIndex, pageSize, totalPages: 2 }
}
function patent(fileId: string, customerName = '客户甲', fileDescription = '专利证书', caseId = '') {
  return { fileId, fileName: `${fileId}.pdf`, fileDescription, customerName, caseVolume: 'V1', ...(caseId ? { caseId } : {}) }
}
function profile(): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', baseTemplateId: 'base-a', overrides: {}, enabled: true, createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' }
}
function file(fileId: string, sessionId = ''): SelectedPatentFile {
  return {
    fileId, fileName: `${fileId}.pdf`, fileDescription: '专利证书', customerName: '客户甲',
    customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: '客户甲', confirmed: true, source: 'explicit' },
    ...(sessionId ? { querySessionId: sessionId } : {})
  }
}
function memoryArea() {
  const store: Record<string, unknown> = {}
  return { async get(key: string) { return { [key]: store[key] } }, async set(items: Record<string, unknown>) { Object.assign(store, items) } }
}
function diskFrom(store: Map<string, unknown>): QueryDisk {
  return {
    async put(id, session) { store.set(id, session); return 'PERSISTED' },
    async get(id) { return (store.get(id) as never) ?? null },
    async all() { return [...store.values()] as never },
    async delete(id) { store.delete(id) }
  }
}

beforeEach(async () => {
  await clearQuerySessionStore()
  clearFileTypeTrees()
})

describe('Phase 3.6 查询快照与内部标识', () => {
  it('drops a file that disappears when the same page is queried again', async () => {
    const query = { caseVolume: 'Q', pageIndex: 1, pageSize: 20 }
    const first = await observeSearchPage({ scope: scopeA, query, result: page([patent('A')], 1) })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope: scopeA, query, result: page([patent('B')], 1),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.session.pages.find(item => item.pageIndex === 1)?.fileIds).toEqual(['B'])
    expect(second.session.files.map(item => item.fileId)).toEqual(['B'])
    const resolved = await resolveSelectedFiles([file('A', first.session.querySessionId)], scopeA, { profiles: [profile()] })
    expect(resolved.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('keeps a file that remains on another page after the first page changes', async () => {
    const query = { caseVolume: 'Q', pageIndex: 1, pageSize: 20 }
    const first = await observeSearchPage({ scope: scopeA, query, result: page([patent('A'), patent('B')], 1) })
    if (!first.ok) throw new Error(first.reason)
    const second = await observeSearchPage({
      scope: scopeA,
      query: { ...query, pageIndex: 2 },
      result: page([patent('A')], 2),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!second.ok) throw new Error(second.reason)
    const replaced = await observeSearchPage({
      scope: scopeA, query, result: page([patent('B')], 1),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    if (!replaced.ok) throw new Error(replaced.reason)
    expect(replaced.session.pages.find(item => item.pageIndex === 1)?.fileIds).toEqual(['B'])
    expect(replaced.session.pages.find(item => item.pageIndex === 2)?.fileIds).toEqual(['A'])
    expect(replaced.session.files.map(item => item.fileId).sort()).toEqual(['A', 'B'])
    const resolved = await resolveSelectedFiles([file('A', first.session.querySessionId)], scopeA, { profiles: [profile()] })
    expect(resolved.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
    expect(resolved.files[0]?.querySessionId).toBe(first.session.querySessionId)
  })

  it('starts a new query run instead of mixing the previous one', async () => {
    const query = { caseVolume: 'Q', pageIndex: 1, pageSize: 20 }
    const first = await observeSearchPage({ scope: scopeA, query, result: page([patent('A')], 1) })
    const second = await observeSearchPage({ scope: scopeA, query, result: page([patent('B')], 1) })
    if (!first.ok || !second.ok) throw new Error('run')
    expect(second.session.querySessionId).not.toBe(first.session.querySessionId)
    expect(second.session.queryFingerprint).toBe(first.session.queryFingerprint)
    const stale = (await sessionsFor(scopeA)).find(item => item.querySessionId === first.session.querySessionId)
    expect(stale?.status).toBe('STALE')
    const mixed = await resolveSelectedFiles([file('A', first.session.querySessionId), file('B', second.session.querySessionId)], scopeA)
    expect(mixed.issue).toBe('MIXED_QUERY_SESSION')
    expect(mixed.selections.every(item => item.verification === 'FILE_SOURCE_UNVERIFIED' || item.verification === 'SEARCH_RESPONSE_OBSERVED')).toBe(true)
    const fresh = await resolveSelectedFiles([file('A', second.session.querySessionId)], scopeA)
    expect(fresh.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')
  })

  it('does not append an old page layout after page size changes', async () => {
    const query = { caseVolume: 'Q', pageIndex: 1, pageSize: 20 }
    const first = await observeSearchPage({ scope: scopeA, query, result: page([patent('A')], 1, 20) })
    if (!first.ok) throw new Error(first.reason)
    const continued = await observeSearchPage({
      scope: scopeA,
      query: { ...query, pageSize: 50 },
      result: page([patent('B')], 1, 50),
      run: { mode: 'continue', querySessionId: first.session.querySessionId }
    })
    expect(continued.ok).toBe(false)
    const restarted = await observeSearchPage({ scope: scopeA, query: { ...query, pageSize: 50 }, result: page([patent('B')], 1, 50), run: { mode: 'start' } })
    if (!restarted.ok) throw new Error(restarted.reason)
    expect(restarted.session.querySessionId).not.toBe(first.session.querySessionId)
    expect(restarted.session.pages.map(item => item.pageIndex)).toEqual([1])
    expect(restarted.session.files.map(item => item.fileId)).toEqual(['B'])
  })

  it('does not keep unverified internal ids submitted with a real file id', async () => {
    const observed = await observeSearchPage({
      scope: scopeA,
      query: { caseVolume: 'Q', pageIndex: 1, pageSize: 20 },
      result: page([patent('A')], 1)
    })
    if (!observed.ok) throw new Error(observed.reason)
    const resolved = await resolveSelectedFiles([{
      ...file('A', observed.session.querySessionId),
      fileDescriptionId: forgedDescription,
      customerId: forgedCustomer,
      caseId: forgedCase
    }], scopeA, { profiles: [profile()] })
    expect(resolved.files[0]?.fileDescriptionId).toBeUndefined()
    expect(resolved.files[0]?.customerId).toBeUndefined()
    expect(resolved.files[0]?.caseId).toBeUndefined()
    expect(resolved.files[0]?.customerName).toBe('客户甲')
    expect(resolved.files[0]?.fileDescription).toBe('专利证书')
    expect(resolved.files[0]?.customerProfileId).toBe('profile-a')
    expect(resolved.selections[0]?.fieldEvidence?.find(item => item.field === 'customerId')?.verified).toBe(false)
    expect(resolved.selections[0]?.fieldEvidence?.find(item => item.field === 'fileId')?.source).toBe('EASY_SEARCH_RESPONSE')
  })

  it('resolves a description id only when the dictionary match is unique', () => {
    const nodes = [
      { id: descriptionId, name: '专利证书', parentId: '', order: 1, childIds: [] },
      { id: forgedDescription, name: '审查意见通知书', parentId: '', order: 2, childIds: [] }
    ]
    expect(resolveFileDescriptionIdentity('专利证书', nodes, caseType)).toEqual({ fileDescriptionId: descriptionId, verified: false, selectable: 'pending' })
    expect(resolveFileDescriptionIdentity('专利证书', [...nodes, { id: forgedCustomer, name: '专利证书', parentId: '', order: 3, childIds: [] }], caseType).verified).toBe(false)
    expect(resolveFileDescriptionIdentity('专利', nodes, caseType).fileDescriptionId).toBeUndefined()
  })

  it('uses a remembered dictionary without accepting the first ambiguous guid', async () => {
    const observed = await observeSearchPage({
      scope: scopeA,
      query: { caseVolume: 'Q', pageIndex: 1, pageSize: 20, resolvedFields: { case_volume: 'Q', case_type: caseType } },
      result: page([patent('A')], 1)
    })
    if (!observed.ok) throw new Error(observed.reason)
    rememberFileTypeTree(scopeA, caseType, [
      { id: descriptionId, name: '专利证书', parentId: '', order: 1, childIds: [] },
      { id: forgedDescription, name: '专利证书', parentId: '', order: 2, childIds: [] }
    ])
    const ambiguous = await resolveSelectedFiles([file('A', observed.session.querySessionId)], scopeA, { profiles: [profile()] })
    expect(ambiguous.files[0]?.fileDescriptionId).toBeUndefined()
    clearFileTypeTrees()
    rememberFileTypeTree(scopeA, caseType, [{ id: descriptionId, name: '专利证书', parentId: '', order: 1, childIds: [] }])
    const unique = await resolveSelectedFiles([file('A', observed.session.querySessionId)], scopeA, { profiles: [profile()] })
    expect(unique.files[0]?.fileDescriptionId).toBeUndefined()
    expect(unique.selections[0]?.descriptionSelectability).toBe('pending')
    expect(unique.selections[0]?.fieldEvidence?.find(item => item.field === 'fileDescriptionId')).toEqual({ field: 'fileDescriptionId', source: 'EASY_DICTIONARY', verified: false })
  })

  it('discards a late search result after the account changes', async () => {
    let started: () => void = () => undefined
    const ready = new Promise<void>(resolve => { started = resolve })
    let release: (value: unknown) => void = () => undefined
    const runtime: WorkspaceHost = {
      connection: new EasyConnectionController(),
      area: memoryArea(),
      tasks: new SerialTaskStore(null),
      evidence: new MemoryEvidenceStore(),
      queryTabs: async () => [{ id: 3, url: `${origin}/inbox`, title: 'EASY' }],
      getTab: async () => ({ id: 3, url: `${origin}/inbox`, title: 'EASY' }),
      createTab: async () => undefined,
      focusTab: async () => undefined,
      openApp: async () => ({ tabId: 7, created: true }),
      sendToTab: async (_tabId, message) => {
        if (message.type === MessageType.SearchFiles) {
          return await new Promise(resolve => {
            release = resolve
            started()
          })
        }
        return { type: MessageType.SessionResult, payload: { ok: true, data: { status: 'authenticated', userId: userA, displayName: '测试员', checkedAt: '2026-09-26T00:00:00.000Z' } } }
      }
    }
    const bound = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'bind', tabId: 3 } }, runtime)
    if (bound.type !== MessageType.WorkspaceResult || !bound.payload.ok) throw new Error('bind')
    const pending = handleWorkspaceMessage({
      type: MessageType.Workspace,
      payload: { action: 'forward', message: { type: MessageType.SearchFiles, payload: { query: { caseVolume: 'Q', pageIndex: 1, pageSize: 20 } } } }
    }, runtime)
    await ready
    const version = runtime.connection.context.connectionVersion
    const tabId = runtime.connection.context.easyTabId ?? 3
    runtime.connection.context = { ...runtime.connection.context, operatorId: userB }
    release({ type: MessageType.SearchFilesResult, payload: { ok: true, data: page([patent('A')], 1) } })
    const result = await pending
    if (result.type !== MessageType.WorkspaceResult) throw new Error('result')
    expect(result.payload.ok).toBe(false)
    expect(await sessionsFor({ easyOrigin: origin, operatorId: userB, easyTabId: tabId, connectionVersion: version })).toEqual([])
    expect(await sessionsFor({ easyOrigin: origin, operatorId: userA, easyTabId: tabId, connectionVersion: version })).toEqual([])
  })

  it('does not restore a snapshot when IndexedDB persistence fails', async () => {
    useQuerySessionDisk({
      async put() { return 'FAILED' },
      async get() { return null },
      async all() { return [] },
      async delete() { return undefined }
    })
    const failed = await observeSearchPage({ scope: scopeA, query: { caseVolume: 'Q', pageIndex: 1, pageSize: 20 }, result: page([patent('A')], 1) })
    if (!failed.ok) throw new Error(failed.reason)
    expect(failed.persistence).toBe('FAILED')
    dropQuerySessionMemory()
    const gone = await resolveSelectedFiles([file('A', failed.session.querySessionId)], scopeA)
    expect(gone.selections[0]?.verification).toBe('FILE_SOURCE_UNVERIFIED')

    const store = new Map<string, unknown>()
    useQuerySessionDisk(diskFrom(store))
    const saved = await observeSearchPage({ scope: scopeA, query: { caseVolume: 'Q', pageIndex: 1, pageSize: 20 }, result: page([patent('B')], 1) })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.persistence).toBe('PERSISTED')
    dropQuerySessionMemory()
    const restored = await resolveSelectedFiles([file('B', saved.session.querySessionId)], scopeA, { profiles: [profile()] })
    expect(restored.selections[0]?.verification).toBe('SEARCH_RESPONSE_OBSERVED')
  })
})
