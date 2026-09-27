import type { FileSearchQuery } from '../api/file-search-params'
import { FILE_SEARCH_SYSTEM_FIELDS, isFileSearchBusinessField } from '../api/file-search-params'
import type { FileSearchResult, PatentFile } from '../api/file-search-types'
import type { CustomerQueryProfile } from '../customer/types'
import type { CustomerBinding, SelectedPatentFile } from '../mail/types'
import { isQueryGuid } from '../query/query-validator'
import { clearFileTypeTrees, fileTypeTreeFor, resolveFileDescriptionIdentity } from './file-description-resolver'
import { sha256Hex } from './sha256'
import type { FileFieldEvidence, VerifiedSelectionSnapshot } from './types'
import type { FileTypeNode } from '../api/dictionaries/types'

const SESSION_TTL_MS = 30 * 60 * 1000
const DB_NAME = 'patmail-file-query-sessions'
const STORE = 'sessions'

/** 查询响应里的文件。字段只来自现有 PatentFile，不另造接口字段。 */
export interface ObservedPatentFile {
  fileId: string
  fileName: string
  fileDescription: string
  caseId: string
  caseVolume: string
  applicationNo: string
  customerName: string
  pageIndex: number
  observedAt: string
  conflict: boolean
}

export interface FileSearchPageSnapshot {
  pageIndex: number
  pageSize: number
  total: number
  queryFingerprint: string
  observedAt: string
  /** 这一页自己的证据失效时间。后一页不能延长它。 */
  evidenceExpiresAt: string
  fileIds: string[]
  files: ObservedPatentFile[]
}

export type QuerySessionStatus = 'ACTIVE' | 'STALE' | 'CONFLICT' | 'EXPIRED'
export type PersistenceResult = 'PERSISTED' | 'MEMORY_ONLY' | 'FAILED'

export interface FileQuerySession {
  querySessionId: string
  queryFingerprint: string
  easyOrigin: string
  operatorId: string
  easyTabId: number
  connectionVersion: number
  pageSize: number
  sortFingerprint: string
  caseTypeId: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  pages: FileSearchPageSnapshot[]
  files: ObservedPatentFile[]
  status: QuerySessionStatus
  persistence: PersistenceResult
}

export interface QueryScope {
  easyOrigin: string
  operatorId: string
  easyTabId: number
  connectionVersion: number
}

export interface QueryDisk {
  put(id: string, session: FileQuerySession): Promise<'PERSISTED' | 'FAILED'>
  get(id: string): Promise<FileQuerySession | null>
  all(): Promise<FileQuerySession[]>
  delete(id: string): Promise<void>
}

export interface ResolveContext {
  profiles?: CustomerQueryProfile[]
  descriptionNodes?: FileTypeNode[]
  caseTypeId?: string
  /** 测试用的观察时钟。缺省为当前时间。 */
  now?: string
}

export type QueryObservationResult =
  | {
      ok: true
      querySessionId: string
      observation: 'SEARCH_RESPONSE_OBSERVED'
      persistence: PersistenceResult
      status: QuerySessionStatus
    }
  | { ok: false; code: string; message: string }

const hot = new Map<string, FileQuerySession>()
const durable = new Map<string, FileQuerySession>()
const activeRuns = new Map<string, string>()
const memoryDisk = new Map<string, FileQuerySession>()
let diskOverride: QueryDisk | 'unavailable' | null = null
const queues = new Map<string, Promise<unknown>>()

function layoutKey(scope: QueryScope, fingerprint: string, pageSize: number, sortFingerprint: string): string {
  return [scope.easyOrigin, scope.operatorId, String(scope.easyTabId), String(scope.connectionVersion), fingerprint, String(pageSize), sortFingerprint].join('\u0000')
}

function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  queues.set(key, run.then(() => undefined, () => undefined))
  return run
}

/** 分页和每页条数不进入业务指纹。排序另记，避免不同顺序拼进同一页布局。 */
export function canonicalFileSearchQuery(query: FileSearchQuery): string {
  const fields: Record<string, string> = {}
  if (query.resolvedFields) {
    for (const key of Object.keys(query.resolvedFields)) {
      if (!isFileSearchBusinessField(key) || FILE_SEARCH_SYSTEM_FIELDS.has(key as never)) continue
      if (/sort|order/i.test(key)) continue
      fields[key] = query.resolvedFields[key] ?? ''
    }
  } else {
    const mapped: Record<string, string> = {
      case_volume: query.caseVolume?.trim() ?? '',
      app_no: query.applicationNo?.trim().replace(/\./g, '') ?? '',
      customer_name_vague: query.customerName?.trim() ?? '',
      file_name: query.fileName?.trim() ?? '',
      filetype: query.fileDescriptionId?.trim() ?? ''
    }
    for (const [key, value] of Object.entries(mapped)) fields[key] = value
  }
  return JSON.stringify(Object.keys(fields).sort().map(key => [key, fields[key]]))
}

export function queryFingerprintOf(query: FileSearchQuery): string {
  return sha256Hex(canonicalFileSearchQuery(query))
}

export function sortFingerprintOf(query: FileSearchQuery): string {
  const source = query.resolvedFields ?? {}
  const keys = Object.keys(source).filter(key => /sort|order/i.test(key)).sort()
  return sha256Hex(JSON.stringify(keys.map(key => [key, source[key] ?? ''])))
}

export function useQuerySessionDisk(disk: QueryDisk | 'unavailable' | null): void {
  diskOverride = disk
}

function text(value: string | undefined): string {
  return value?.trim() ?? ''
}

function sameScope(session: FileQuerySession, scope: QueryScope): boolean {
  return session.easyOrigin === scope.easyOrigin && session.operatorId === scope.operatorId &&
    session.easyTabId === scope.easyTabId && session.connectionVersion === scope.connectionVersion
}

function observeFile(item: PatentFile, pageIndex: number, observedAt: string): ObservedPatentFile | null {
  if (!item.fileId) return null
  return {
    fileId: item.fileId,
    fileName: text(item.fileName),
    fileDescription: text(item.fileDescription),
    caseId: text(item.caseId),
    caseVolume: text(item.caseVolume),
    applicationNo: text(item.applicationNo),
    customerName: text(item.customerName),
    pageIndex,
    observedAt,
    conflict: false
  }
}

function sameBusiness(left: ObservedPatentFile, right: ObservedPatentFile): boolean {
  return left.fileName === right.fileName && left.fileDescription === right.fileDescription &&
    left.customerName === right.customerName && left.caseId === right.caseId &&
    left.caseVolume === right.caseVolume && left.applicationNo === right.applicationNo
}

function filesFromResult(items: PatentFile[], pageIndex: number, observedAt: string): ObservedPatentFile[] {
  const map = new Map<string, ObservedPatentFile>()
  for (const item of items) {
    const observed = observeFile(item, pageIndex, observedAt)
    if (!observed) continue
    const previous = map.get(observed.fileId)
    if (previous && !sameBusiness(previous, observed)) {
      map.set(observed.fileId, { ...previous, conflict: true })
      continue
    }
    if (!previous) map.set(observed.fileId, observed)
  }
  return [...map.values()]
}

function indexFromPages(pages: FileSearchPageSnapshot[]): { files: ObservedPatentFile[]; conflict: boolean } {
  const grouped = new Map<string, ObservedPatentFile[]>()
  for (const page of pages) {
    for (const file of page.files) {
      const copies = grouped.get(file.fileId) ?? []
      copies.push({ ...file, pageIndex: page.pageIndex })
      grouped.set(file.fileId, copies)
    }
  }
  let conflict = false
  const files: ObservedPatentFile[] = []
  for (const copies of grouped.values()) {
    const first = copies[0]
    if (!first) continue
    const mismatched = copies.some(item => item.conflict || !sameBusiness(item, first))
    if (mismatched) conflict = true
    const latest = copies[copies.length - 1] ?? first
    files.push({ ...latest, conflict: mismatched })
  }
  return { files, conflict }
}

function fresh(session: FileQuerySession, now = Date.now()): FileQuerySession | null {
  if (Date.parse(session.expiresAt) <= now) return null
  if (session.status === 'EXPIRED') return null
  return session
}

function normalize(value: FileQuerySession | null | undefined): FileQuerySession | null {
  if (!value?.querySessionId || !value.queryFingerprint) return null
  const pages = (value.pages ?? []).map(page => ({
    ...page,
    evidenceExpiresAt: page.evidenceExpiresAt || evidenceExpiry(page.observedAt),
    fileIds: page.fileIds ?? [],
    files: page.files ?? []
  }))
  return {
    ...value,
    pageSize: value.pageSize || pages[0]?.pageSize || 0,
    sortFingerprint: value.sortFingerprint ?? '',
    caseTypeId: value.caseTypeId ?? '',
    status: value.status ?? 'STALE',
    persistence: value.persistence ?? 'PERSISTED',
    pages,
    files: value.files ?? []
  }
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null
  return await new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function defaultPut(id: string, session: FileQuerySession): Promise<'PERSISTED' | 'FAILED' | 'UNAVAILABLE'> {
  if (diskOverride === 'unavailable') return 'UNAVAILABLE'
  if (diskOverride) {
    try {
      return await diskOverride.put(id, session)
    } catch {
      return 'FAILED'
    }
  }
  if (typeof indexedDB === 'undefined') {
    memoryDisk.set(id, session)
    return 'PERSISTED'
  }
  const database = await openDb()
  if (!database) return 'UNAVAILABLE'
  return await new Promise(resolve => {
    try {
      const tx = database.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(session, id)
      tx.oncomplete = () => resolve('PERSISTED')
      tx.onabort = () => resolve('FAILED')
      tx.onerror = () => resolve('FAILED')
    } catch {
      resolve('FAILED')
    }
  })
}

async function defaultGet(id: string): Promise<FileQuerySession | null> {
  if (diskOverride === 'unavailable') return null
  if (diskOverride) return diskOverride.get(id)
  if (typeof indexedDB === 'undefined') return memoryDisk.get(id) ?? null
  const database = await openDb()
  if (!database) return null
  return await new Promise(resolve => {
    const tx = database.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(normalize(request.result as FileQuerySession | undefined) )
    request.onerror = () => resolve(null)
  })
}

async function defaultAll(): Promise<FileQuerySession[]> {
  if (diskOverride === 'unavailable') return []
  if (diskOverride) return diskOverride.all()
  if (typeof indexedDB === 'undefined') return [...memoryDisk.values()]
  const database = await openDb()
  if (!database) return []
  return await new Promise(resolve => {
    const tx = database.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).getAll()
    request.onsuccess = () => resolve((Array.isArray(request.result) ? request.result : []).map(item => normalize(item as FileQuerySession)).filter((item): item is FileQuerySession => Boolean(item)))
    request.onerror = () => resolve([])
  })
}

async function defaultDelete(id: string): Promise<void> {
  if (diskOverride === 'unavailable') return
  if (diskOverride) {
    await diskOverride.delete(id)
    return
  }
  memoryDisk.delete(id)
  if (typeof indexedDB === 'undefined') return
  const database = await openDb()
  if (!database) return
  await new Promise<void>(resolve => {
    const tx = database.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onabort = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function persist(session: FileQuerySession): Promise<FileQuerySession> {
  const candidate: FileQuerySession = { ...session, persistence: 'PERSISTED' }
  const outcome = await defaultPut(session.querySessionId, candidate)
  if (outcome === 'PERSISTED') {
    hot.set(session.querySessionId, candidate)
    durable.set(session.querySessionId, candidate)
    return candidate
  }
  const kept: FileQuerySession = { ...session, persistence: outcome === 'UNAVAILABLE' ? 'MEMORY_ONLY' : 'FAILED' }
  hot.set(session.querySessionId, kept)
  durable.delete(session.querySessionId)
  await defaultDelete(session.querySessionId)
  return kept
}

async function readSession(id: string, now = Date.now()): Promise<FileQuerySession | null> {
  const stored = normalize(hot.get(id) ?? durable.get(id) ?? await defaultGet(id))
  if (!stored) return null
  const alive = fresh(stored, now)
  if (!alive) {
    hot.delete(id)
    durable.delete(id)
    await defaultDelete(id)
    return null
  }
  if (alive.persistence === 'PERSISTED') durable.set(id, alive)
  return alive
}

/** 丢掉当前进程内存。只有已经写入磁盘的会话还能恢复。 */
export function dropQuerySessionMemory(): void {
  hot.clear()
  durable.clear()
  activeRuns.clear()
}

export async function clearQuerySessionStore(): Promise<void> {
  const ids = new Set<string>([...hot.keys(), ...durable.keys(), ...memoryDisk.keys()])
  const rest = await defaultAll()
  for (const session of rest) ids.add(session.querySessionId)
  hot.clear()
  durable.clear()
  activeRuns.clear()
  memoryDisk.clear()
  diskOverride = null
  clearFileTypeTrees()
  await Promise.all([...ids].map(id => defaultDelete(id)))
}

function caseTypeOf(query: FileSearchQuery): string {
  const value = query.resolvedFields?.case_type?.trim() ?? ''
  return isQueryGuid(value) ? value : ''
}

function evidenceExpiry(observedAt: string): string {
  return new Date(Date.parse(observedAt) + SESSION_TTL_MS).toISOString()
}

function buildPage(result: FileSearchResult, fingerprint: string, observedAt: string): FileSearchPageSnapshot {
  const files = filesFromResult(result.items, result.pageIndex, observedAt)
  return {
    pageIndex: result.pageIndex,
    pageSize: result.pageSize,
    total: result.total,
    queryFingerprint: fingerprint,
    observedAt,
    evidenceExpiresAt: evidenceExpiry(observedAt),
    fileIds: files.map(item => item.fileId),
    files
  }
}

function compose(current: FileQuerySession, page: FileSearchPageSnapshot, observedAt: string): FileQuerySession {
  const pages = [...current.pages.filter(item => item.pageIndex !== page.pageIndex), page]
    .sort((left, right) => left.pageIndex - right.pageIndex)
  const indexed = indexFromPages(pages)
  const expiresAt = pages.reduce((latest, item) => item.evidenceExpiresAt > latest ? item.evidenceExpiresAt : latest, page.evidenceExpiresAt)
  return {
    ...current,
    updatedAt: observedAt,
    expiresAt,
    pages,
    files: indexed.files,
    status: indexed.conflict ? 'CONFLICT' : 'ACTIVE'
  }
}

async function findActive(scope: QueryScope, fingerprint: string, pageSize: number, sortFingerprint: string): Promise<FileQuerySession | null> {
  const key = layoutKey(scope, fingerprint, pageSize, sortFingerprint)
  const pointed = activeRuns.get(key)
  if (pointed) {
    const current = await readSession(pointed)
    if (current?.status === 'ACTIVE' && sameScope(current, scope) && current.queryFingerprint === fingerprint && current.pageSize === pageSize && current.sortFingerprint === sortFingerprint) return current
  }
  const sessions = await sessionsFor(scope)
  const matches = sessions.filter(item => item.status === 'ACTIVE' && item.queryFingerprint === fingerprint && item.pageSize === pageSize && item.sortFingerprint === sortFingerprint)
    .sort((left, right) => left.updatedAt < right.updatedAt ? 1 : -1)
  const chosen = matches[0]
  if (chosen) activeRuns.set(key, chosen.querySessionId)
  return chosen ?? null
}

export async function observeSearchPage(input: {
  scope: QueryScope
  query: FileSearchQuery
  result: FileSearchResult
  observedAt?: string
  run?: { mode: 'start' } | { mode: 'continue'; querySessionId: string }
}): Promise<{ ok: true; session: FileQuerySession; persistence: PersistenceResult } | { ok: false; reason: string; code: string }> {
  if (input.result.pageIndex !== input.query.pageIndex || input.result.pageSize !== input.query.pageSize) {
    return { ok: false, reason: '响应页码与请求页码不一致。', code: 'PAGE_MISMATCH' }
  }
  const fingerprint = queryFingerprintOf(input.query)
  const sortFingerprint = sortFingerprintOf(input.query)
  const pageSize = input.query.pageSize
  const run = input.run ?? { mode: 'start' as const }
  const key = layoutKey(input.scope, fingerprint, pageSize, sortFingerprint)
  return enqueue(key, async () => {
    const observedAt = input.observedAt ?? new Date().toISOString()
    const page = buildPage(input.result, fingerprint, observedAt)
    if (run.mode === 'continue') {
      const current = await readSession(run.querySessionId, Date.parse(observedAt))
      if (!current || current.status === 'STALE' || current.status === 'EXPIRED' || !sameScope(current, input.scope)) {
        return { ok: false as const, reason: '查询运行已失效，需要重新查询。', code: 'QUERY_SESSION_INVALID' }
      }
      if (current.queryFingerprint !== fingerprint || current.pageSize !== pageSize || current.sortFingerprint !== sortFingerprint) {
        return { ok: false as const, reason: '分页布局或查询条件已变化，需要重新查询。', code: 'QUERY_LAYOUT_CHANGED' }
      }
      const next = await persist(compose(current, page, observedAt))
      if (next.status === 'ACTIVE') activeRuns.set(key, next.querySessionId)
      return { ok: true as const, session: next, persistence: next.persistence }
    }
    const previous = await findActive(input.scope, fingerprint, pageSize, sortFingerprint)
    if (previous) await persist({ ...previous, status: 'STALE', updatedAt: observedAt })
    const created: FileQuerySession = {
      querySessionId: globalThis.crypto.randomUUID(),
      queryFingerprint: fingerprint,
      ...input.scope,
      pageSize,
      sortFingerprint,
      caseTypeId: caseTypeOf(input.query),
      createdAt: observedAt,
      updatedAt: observedAt,
      expiresAt: new Date(Date.parse(observedAt) + SESSION_TTL_MS).toISOString(),
      pages: [],
      files: [],
      status: 'ACTIVE',
      persistence: 'MEMORY_ONLY'
    }
    const next = await persist(compose(created, page, observedAt))
    activeRuns.set(key, next.querySessionId)
    return { ok: true as const, session: next, persistence: next.persistence }
  })
}

export async function sessionsFor(scope: QueryScope): Promise<FileQuerySession[]> {
  const merged = new Map<string, FileQuerySession>()
  for (const session of [...hot.values(), ...durable.values(), ...await defaultAll()]) {
    const normalized = normalize(session)
    if (normalized) merged.set(normalized.querySessionId, normalized)
  }
  const alive: FileQuerySession[] = []
  for (const [id, session] of merged) {
    if (!sameScope(session, scope)) continue
    const current = fresh(session)
    if (!current) {
      hot.delete(id)
      durable.delete(id)
      await defaultDelete(id)
      continue
    }
    alive.push(current)
  }
  return alive
}

function differs(pageValue: string | undefined, observed: string): boolean {
  const value = text(pageValue)
  return value !== '' && value !== observed
}

function unverifiedFile(request: SelectedPatentFile): SelectedPatentFile {
  return {
    fileId: request.fileId,
    fileName: request.fileName || request.fileId,
    fileDescription: request.fileDescription,
    customerName: request.customerName,
    ...(request.caseVolume ? { caseVolume: request.caseVolume } : {}),
    ...(request.applicationNo ? { applicationNo: request.applicationNo } : {}),
    ...(request.customerProfileId ? { customerProfileId: request.customerProfileId } : {}),
    ...(request.customerBinding ? { customerBinding: request.customerBinding } : {}),
    ...(request.querySessionId ? { querySessionId: request.querySessionId } : {})
  }
}

function unverifiedSelection(request: SelectedPatentFile, scope: QueryScope): VerifiedSelectionSnapshot {
  return {
    fileId: request.fileId,
    querySource: 'FILE_SEARCH_PAGE',
    customerProfileId: '',
    fileDescription: '',
    fileName: request.fileId,
    fetchedAt: '',
    easyOrigin: scope.easyOrigin,
    operatorId: scope.operatorId,
    verification: 'FILE_SOURCE_UNVERIFIED',
    fieldEvidence: [
      { field: 'fileId', source: 'UNKNOWN', verified: false },
      { field: 'fileDescriptionId', source: 'UNKNOWN', verified: false },
      { field: 'customerId', source: 'UNKNOWN', verified: false },
      { field: 'caseId', source: 'UNKNOWN', verified: false },
      { field: 'customerProfileId', source: 'UNKNOWN', verified: false }
    ]
  }
}

function localBinding(request: SelectedPatentFile, source: ObservedPatentFile, profiles: CustomerQueryProfile[]): { customerProfileId?: string; customerBinding?: CustomerBinding } {
  const profileId = request.customerProfileId?.trim() ?? ''
  const profile = profiles.find(item => item.id === profileId && item.enabled)
  const binding = request.customerBinding
  if (!profile || !binding || binding.confirmed !== true || binding.source !== 'explicit' || binding.profileId !== profile.id) return {}
  if (binding.sourceCustomerName.trim() !== source.customerName.trim()) return {}
  return {
    customerProfileId: profile.id,
    customerBinding: {
      profileId: profile.id,
      profileName: profile.name,
      sourceCustomerName: source.customerName,
      confirmed: true,
      source: 'explicit'
    }
  }
}

function fieldEvidence(source: ObservedPatentFile, descriptionMatched: boolean, descriptionVerified: boolean, profileVerified: boolean): FileFieldEvidence[] {
  return [
    { field: 'fileId', source: 'EASY_SEARCH_RESPONSE', verified: true },
    { field: 'fileDescriptionId', source: descriptionMatched ? 'EASY_DICTIONARY' : 'UNKNOWN', verified: descriptionVerified },
    { field: 'customerId', source: 'UNKNOWN', verified: false },
    { field: 'caseId', source: source.caseId ? 'EASY_SEARCH_RESPONSE' : 'UNKNOWN', verified: Boolean(source.caseId) },
    { field: 'customerProfileId', source: profileVerified ? 'LOCAL_PROFILE' : 'UNKNOWN', verified: profileVerified }
  ]
}

function pageStillValid(page: FileSearchPageSnapshot, now: number): boolean {
  return Date.parse(page.evidenceExpiresAt || evidenceExpiry(page.observedAt)) > now
}

function liveCopies(session: FileQuerySession, fileId: string, now: number): ObservedPatentFile[] {
  return session.pages
    .filter(page => pageStillValid(page, now))
    .flatMap(page => page.files.filter(file => file.fileId === fileId))
}

function evidenceExpiresFor(session: FileQuerySession, fileId: string, now: number): string {
  const times = session.pages
    .filter(page => pageStillValid(page, now) && page.files.some(file => file.fileId === fileId && !file.conflict))
    .map(page => page.evidenceExpiresAt)
    .sort()
  return times[0] ?? ''
}

export async function resolveSelectedFiles(requested: SelectedPatentFile[], scope: QueryScope, context: ResolveContext = {}): Promise<{
  files: SelectedPatentFile[]
  selections: VerifiedSelectionSnapshot[]
  mismatches: string[]
  issue?: 'MIXED_QUERY_SESSION' | 'FILE_DATA_CONFLICT'
}> {
  const now = context.now ? Date.parse(context.now) : Date.now()
  const ids = [...new Set(requested.map(item => item.querySessionId?.trim() ?? ''))]
  const mixed = ids.filter(Boolean).length > 1
  let conflict = false
  const mismatches: string[] = []
  const files: SelectedPatentFile[] = []
  const selections: VerifiedSelectionSnapshot[] = []
  for (const request of requested) {
    const sessionId = request.querySessionId?.trim() ?? ''
    const session = sessionId ? await readSession(sessionId, now) : null
    const copies = session && session.status !== 'STALE' && session.status !== 'EXPIRED' && sameScope(session, scope)
      ? liveCopies(session, request.fileId, now)
      : []
    const disagreed = copies.some(item => item.conflict) || copies.some(item => !sameBusiness(item, copies[0]!))
    if (disagreed) conflict = true
    const source = !disagreed ? copies[0] : undefined
    if (!session || !source) {
      files.push(unverifiedFile(request))
      selections.push(unverifiedSelection(request, scope))
      continue
    }
    if (differs(request.fileName, source.fileName) || differs(request.fileDescription, source.fileDescription) ||
        differs(request.customerName, source.customerName) || differs(request.caseVolume, source.caseVolume) ||
        differs(request.caseId, source.caseId) || differs(request.applicationNo, source.applicationNo)) {
      mismatches.push(request.fileId)
    }
    const profiles = context.profiles ?? []
    const binding = localBinding(request, source, profiles)
    const caseTypeId = context.caseTypeId || session.caseTypeId
    const nodes = context.descriptionNodes ?? (caseTypeId ? fileTypeTreeFor(scope, caseTypeId) : [])
    const description = resolveFileDescriptionIdentity(source.fileDescription, nodes, caseTypeId)
    const rebuilt: SelectedPatentFile = {
      fileId: source.fileId,
      fileName: source.fileName,
      fileDescription: source.fileDescription,
      customerName: source.customerName,
      ...(source.caseId ? { caseId: source.caseId } : {}),
      ...(source.caseVolume ? { caseVolume: source.caseVolume } : {}),
      ...(source.applicationNo ? { applicationNo: source.applicationNo } : {}),
      ...(description.verified && description.fileDescriptionId ? { fileDescriptionId: description.fileDescriptionId } : {}),
      ...binding,
      querySessionId: session.querySessionId
    }
    files.push(rebuilt)
    selections.push({
      fileId: source.fileId,
      querySource: 'FILE_SEARCH_PAGE',
      customerProfileId: binding.customerProfileId ?? '',
      fileDescription: source.fileDescription,
      fileName: source.fileName,
      sourceCustomerName: source.customerName,
      caseVolume: source.caseVolume,
      ...(source.caseId ? { caseId: source.caseId } : {}),
      querySessionId: session.querySessionId,
      fetchedAt: source.observedAt,
      evidenceExpiresAt: evidenceExpiresFor(session, source.fileId, now),
      persistence: session.persistence,
      descriptionSelectability: description.selectable,
      easyOrigin: session.easyOrigin,
      operatorId: session.operatorId,
      verification: 'SEARCH_RESPONSE_OBSERVED',
      fieldEvidence: fieldEvidence(source, Boolean(description.fileDescriptionId), description.verified, Boolean(binding.customerProfileId))
    })
  }
  const issue = mixed ? 'MIXED_QUERY_SESSION' as const : conflict ? 'FILE_DATA_CONFLICT' as const : undefined
  return { files, selections, mismatches, ...(issue ? { issue } : {}) }
}

export function toQueryObservation(result: Awaited<ReturnType<typeof observeSearchPage>>): QueryObservationResult {
  if (!result.ok) return { ok: false, code: result.code, message: result.reason }
  return {
    ok: true,
    querySessionId: result.session.querySessionId,
    observation: 'SEARCH_RESPONSE_OBSERVED',
    persistence: result.persistence,
    status: result.session.status
  }
}
