import { isQueryGuid } from '../query/query-validator'
import { isRecord } from '../shared/guards'
import { isFileSearchBusinessField, type FileSearchQuery } from './file-search-params'
import type { DictionarySnapshot } from './dictionaries'
import type { HistoryQueryDetail, HistoryQueryOption } from './query-history'
import type { FileSearchResult, PatentFile } from './file-search-types'
import { isLimitMonitorInputField, isLimitMonitorType, type LimitMonitorQuery } from './limit-monitor-params'
import type { LimitMonitorResult, LimitMonitorRow } from './limit-monitor-types'
import { isProcessKind, isProcessOpenTarget, PROCESS_SPECS, type ProcessListQuery, type ProcessListResult, type ProcessListRow } from './mail-process'
import type { SessionSummary } from './session'
import type { CaseContactExport } from '../case-contact/query'
import type { ApiError, ApiResult } from './types'

const QUERY_KEYS = new Set([
  'caseVolume', 'applicationNo', 'customerName', 'fileName', 'fileDescriptionId',
  'resolvedFields', 'pageIndex', 'pageSize'
])
const ERROR_CODES = new Set([
  'INVALID_ORIGIN', 'INVALID_QUERY', 'NETWORK_ERROR', 'REQUEST_TIMEOUT',
  'HTTP_ERROR', 'SESSION_EXPIRED', 'AUTH_UNKNOWN', 'BUSINESS_ERROR',
  'INVALID_RESPONSE', 'UNEXPECTED_HTML', 'REQUEST_ABORTED'
])

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isResolvedFields(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > 120) return false
  return Object.keys(value).every(key => isFileSearchBusinessField(key) &&
    typeof value[key] === 'string' && value[key].length <= 4000)
}

export function isFileSearchQuery(value: unknown): value is FileSearchQuery {
  if (!isRecord(value) || Object.keys(value).some(key => !QUERY_KEYS.has(key))) return false
  if (value.resolvedFields !== undefined && !isResolvedFields(value.resolvedFields)) return false
  return Number.isSafeInteger(value.pageIndex) && Number(value.pageIndex) >= 1 &&
    Number.isSafeInteger(value.pageSize) && Number(value.pageSize) >= 1 &&
    Number(value.pageSize) <= 100 &&
    ['caseVolume', 'applicationNo', 'customerName', 'fileName', 'fileDescriptionId']
      .every(key => optionalString(value[key]))
}

function pageNumber(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : fallback
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) return fallback
  return parsed
}

/** 丢掉未登记字段、超长值和非法页码，避免一条坏字段让整次查询被后台拒绝。 */
export function coerceFileSearchQuery(value: unknown): FileSearchQuery | null {
  if (!isRecord(value)) return null
  const resolved: Record<string, string> = {}
  const source = isRecord(value.resolvedFields) ? value.resolvedFields : {}
  const entries = Object.entries(source).filter((entry): entry is [string, string] =>
    isFileSearchBusinessField(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 4000)
  const ranked = [...entries.filter(([, text]) => text.trim()), ...entries.filter(([, text]) => !text.trim())]
  for (const [key, text] of ranked) {
    if (Object.keys(resolved).length >= 120) break
    resolved[key] = text
  }
  const query: FileSearchQuery = {
    resolvedFields: resolved,
    pageIndex: pageNumber(value.pageIndex, 1, 1_000_000),
    pageSize: pageNumber(value.pageSize, 20, 100)
  }
  for (const key of ['caseVolume', 'applicationNo', 'customerName', 'fileName', 'fileDescriptionId'] as const) {
    const raw = value[key]
    if (typeof raw === 'string' && raw.length <= 4000) query[key] = raw
  }
  return query
}

const CONTINUATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 转发到后台之前先收成校验能通过的查询。校验本身仍然拒绝脏消息。 */
export function prepareForwardedSearch(message: unknown): void {
  if (!isRecord(message) || message.type !== 'WORKSPACE' || !isRecord(message.payload)) return
  if (message.payload.action !== 'forward' || !isRecord(message.payload.message)) return
  const inner = message.payload.message
  if (inner.type !== 'SEARCH_FILES' || !isRecord(inner.payload)) return
  const query = coerceFileSearchQuery(inner.payload.query)
  if (!query) return
  const continuation = inner.payload.continuation
  const keep = isRecord(continuation) && Object.keys(continuation).length === 1 &&
    typeof continuation.querySessionId === 'string' && CONTINUATION_ID.test(continuation.querySessionId)
  inner.payload = keep ? { query, continuation } : { query }
}

function isApiError(value: unknown): value is ApiError {
  return isRecord(value) && typeof value.code === 'string' && ERROR_CODES.has(value.code) &&
    typeof value.message === 'string' &&
    (value.status === undefined || Number.isSafeInteger(value.status)) &&
    (value.responseKeys === undefined ||
      (Array.isArray(value.responseKeys) && value.responseKeys.every(key => typeof key === 'string')))
}

function isApiResult<T>(value: unknown, isData: (data: unknown) => data is T): value is ApiResult<T> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isApiError(value.error)
  return value.ok === true && isData(value.data)
}

function isSessionSummary(value: unknown): value is SessionSummary {
  return isRecord(value) &&
    ['unknown', 'checking', 'authenticated', 'unauthenticated', 'expired', 'error'].includes(String(value.status)) &&
    typeof value.checkedAt === 'string' && optionalString(value.displayName) &&
    optionalString(value.userId) && optionalString(value.message)
}

const OPTIONAL_FILE_KEYS = [
  'fileNo', 'fileDescription', 'fileStatus', 'fileType', 'caseId', 'caseName',
  'caseVolume', 'customerVolume', 'applicationNo', 'applicationType', 'customerName',
  'uploadTime', 'officialPostDate'
] as const

function isPatentFile(value: unknown): value is PatentFile {
  return isRecord(value) && typeof value.fileId === 'string' &&
    typeof value.fileName === 'string' && OPTIONAL_FILE_KEYS.every(key => optionalString(value[key]))
}

function isFileSearchResult(value: unknown): value is FileSearchResult {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isPatentFile) &&
    Number.isSafeInteger(value.total) && Number(value.total) >= 0 &&
    Number.isSafeInteger(value.pageIndex) && Number(value.pageIndex) >= 1 &&
    Number.isSafeInteger(value.pageSize) && Number(value.pageSize) >= 1 &&
    Number.isSafeInteger(value.totalPages) && Number(value.totalPages) >= 0
}

export function isSessionResult(value: unknown): value is ApiResult<SessionSummary> {
  return isApiResult(value, isSessionSummary)
}

export function isFileSearchApiResult(value: unknown): value is ApiResult<FileSearchResult> {
  return isApiResult(value, isFileSearchResult)
}

const LIMIT_QUERY_KEYS = new Set(['type', 'caseVolume', 'applicationNo', 'customerName', 'ctrlProcId', 'fields', 'pageIndex', 'pageSize'])

export function isLimitMonitorQuery(value: unknown): value is LimitMonitorQuery {
  if (!isRecord(value) || Object.keys(value).some(key => !LIMIT_QUERY_KEYS.has(key))) return false
  if (typeof value.type !== 'string' || !isLimitMonitorType(value.type)) return false
  if (value.fields !== undefined && (!isRecord(value.fields) || Object.entries(value.fields).some(([key, item]) => !isLimitMonitorInputField(key) || typeof item !== 'string' || item.length > 4000))) return false
  return Number.isSafeInteger(value.pageIndex) && Number(value.pageIndex) >= 1 &&
    Number.isSafeInteger(value.pageSize) && Number(value.pageSize) >= 1 && Number(value.pageSize) <= 100 &&
    ['caseVolume', 'applicationNo', 'customerName', 'ctrlProcId'].every(key => optionalString(value[key]))
}

function isLimitRow(value: unknown): value is LimitMonitorRow {
  return isRecord(value) && ['procId', 'caseId', 'caseVolume', 'caseName', 'ctrlProc', 'customerName', 'appNo', 'docDate', 'intDueDate', 'cusDueDate', 'legalDueDate']
    .every(key => typeof value[key] === 'string')
}

function isLimitResult(value: unknown): value is LimitMonitorResult {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isLimitRow) &&
    Number.isSafeInteger(value.total) && Number(value.total) >= 0 &&
    Number.isSafeInteger(value.pageIndex) && Number(value.pageIndex) >= 1 &&
    Number.isSafeInteger(value.pageSize) && Number(value.pageSize) >= 1 &&
    Number.isSafeInteger(value.totalPages) && Number(value.totalPages) >= 0
}

export function isLimitMonitorApiResult(value: unknown): value is ApiResult<LimitMonitorResult> {
  return isApiResult(value, isLimitResult)
}

const MAIL_PROCESS_KEYS = new Set(['kind', 'searchKey', 'pageIndex', 'pageSize'])

export function isMailProcessQuery(value: unknown): value is ProcessListQuery {
  if (!isRecord(value) || Object.keys(value).some(key => !MAIL_PROCESS_KEYS.has(key))) return false
  return isProcessKind(value.kind) && typeof value.searchKey === 'string' && value.searchKey.length <= 200 &&
    Number.isSafeInteger(value.pageIndex) && Number(value.pageIndex) >= 1 &&
    Number.isSafeInteger(value.pageSize) && Number(value.pageSize) >= 1 && Number(value.pageSize) <= 100
}

function isProcessListRow(value: unknown, kind: ProcessListQuery['kind']): value is ProcessListRow {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.cells)) return false
  if (Object.keys(value).some(key => key !== 'id' && key !== 'cells' && key !== 'open')) return false
  if (value.open !== null && !isProcessOpenTarget(value.open)) return false
  if (isRecord(value.open) && value.open.kind !== kind) return false
  const columns = PROCESS_SPECS[kind].columns
  const cells = value.cells
  return Object.keys(cells).length === columns.length && columns.every(column => typeof cells[column.key] === 'string')
}

function isMailProcessResult(value: unknown): value is ProcessListResult {
  if (!isRecord(value) || !isProcessKind(value.kind)) return false
  const kind = value.kind
  return Array.isArray(value.items) && value.items.every(item => isProcessListRow(item, kind)) &&
    Number.isSafeInteger(value.total) && Number(value.total) >= 0 &&
    Number.isSafeInteger(value.pageIndex) && Number(value.pageIndex) >= 1 &&
    Number.isSafeInteger(value.pageSize) && Number(value.pageSize) >= 1 &&
    Number.isSafeInteger(value.totalPages) && Number(value.totalPages) >= 0 &&
    Object.keys(value).every(key => ['kind', 'items', 'total', 'pageIndex', 'pageSize', 'totalPages'].includes(key))
}

export function isMailProcessApiResult(value: unknown): value is ApiResult<ProcessListResult> {
  return isApiResult(value, isMailProcessResult)
}

function isHistoryOption(value: unknown): value is HistoryQueryOption {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && value.source === 'easy'
}

function isHistoryDetail(value: unknown): value is HistoryQueryDetail {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.queryXml === 'string'
}

export function isHistoryListResult(value: unknown): value is ApiResult<HistoryQueryOption[]> {
  return isApiResult(value, (data): data is HistoryQueryOption[] => Array.isArray(data) && data.every(isHistoryOption))
}

export function isHistoryDetailResult(value: unknown): value is ApiResult<HistoryQueryDetail> {
  return isApiResult(value, isHistoryDetail)
}

export function isHistorySaveResult(value: unknown): value is ApiResult<{ saved: true }> {
  return isApiResult(value, (data): data is { saved: true } => isRecord(data) && data.saved === true && Object.keys(data).length === 1)
}

export function isHistoryDeleteResult(value: unknown): value is ApiResult<{ deleted: true }> {
  return isApiResult(value, (data): data is { deleted: true } => isRecord(data) && data.deleted === true && Object.keys(data).length === 1)
}

function isCustomerListSnapshot(value: Record<string, unknown>): boolean {
  if (value.kind !== 'customerList' || Object.keys(value).length !== 2 || !Array.isArray(value.customers) || value.customers.length > 5000) return false
  return value.customers.every(item => isRecord(item) && Object.keys(item).length === 2 &&
    typeof item.id === 'string' && isQueryGuid(item.id) &&
    typeof item.name === 'string' && item.name.trim() === item.name && item.name.length > 0 && item.name.length <= 200)
}

function isDictionarySnapshot(value: unknown): value is DictionarySnapshot {
  return isRecord(value) && (value.kind === 'basic' || value.kind === 'flow' || value.kind === 'fileType' ||
    value.kind === 'fieldColumn' || value.kind === 'listColumn' || value.kind === 'mailType' || value.kind === 'reviewer' || value.kind === 'picker' || value.kind === 'mailSet' || value.kind === 'signature' ||
    isCustomerListSnapshot(value))
}

export function isDictionaryResult(value: unknown): value is ApiResult<DictionarySnapshot> {
  return isApiResult(value, isDictionarySnapshot)
}

function isBoundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
}

function isVolumeToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && !/[\u0000-\u001f<>]/.test(value)
}

export function isVolumeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 300 && value.every(isVolumeToken)
}

function isContactRow(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 3 &&
    isVolumeToken(value.volume) && isBoundedText(value.tech, 80) && isBoundedText(value.email, 200)
}

function isCaseContactExport(value: unknown): value is CaseContactExport {
  if (!isRecord(value) || Object.keys(value).length !== 3) return false
  if (!Array.isArray(value.rows) || !Array.isArray(value.unmatched) || !Array.isArray(value.failed)) return false
  if (value.rows.length > 300 || value.unmatched.length > 300 || value.failed.length > 300) return false
  return value.rows.every(isContactRow) && value.unmatched.every(isVolumeToken) && value.failed.every(isVolumeToken)
}

export function isCaseContactResult(value: unknown): value is ApiResult<CaseContactExport> {
  return isApiResult(value, isCaseContactExport)
}
