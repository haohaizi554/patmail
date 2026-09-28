import { isRecord } from '../shared/guards'
import { isFileSearchBusinessField, type FileSearchQuery } from './file-search-params'
import type { DictionarySnapshot } from './dictionaries'
import type { HistoryQueryDetail, HistoryQueryOption } from './query-history'
import type { FileSearchResult, PatentFile } from './file-search-types'
import { isLimitMonitorInputField, isLimitMonitorType, type LimitMonitorQuery } from './limit-monitor-params'
import type { LimitMonitorResult, LimitMonitorRow } from './limit-monitor-types'
import { isProcessKind, isProcessOpenTarget, PROCESS_SPECS, type ProcessListQuery, type ProcessListResult, type ProcessListRow } from './mail-process'
import type { SessionSummary } from './session'
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
  'caseVolume', 'applicationNo', 'applicationType', 'customerName',
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

function isDictionarySnapshot(value: unknown): value is DictionarySnapshot {
  return isRecord(value) && (value.kind === 'basic' || value.kind === 'flow' || value.kind === 'fileType' ||
    value.kind === 'fieldColumn' || value.kind === 'listColumn' || value.kind === 'mailType' || value.kind === 'reviewer' || value.kind === 'picker' || value.kind === 'mailSet')
}

export function isDictionaryResult(value: unknown): value is ApiResult<DictionarySnapshot> {
  return isApiResult(value, isDictionarySnapshot)
}
