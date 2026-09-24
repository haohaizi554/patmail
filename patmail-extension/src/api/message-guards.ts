import { isRecord } from '../shared/guards'
import { isFileSearchBusinessField, type FileSearchQuery } from './file-search-params'
import type { HistoryQueryDetail, HistoryQueryOption } from './query-history'
import type { FileSearchResult, PatentFile } from './file-search-types'
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
