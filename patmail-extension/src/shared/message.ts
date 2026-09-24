import type { PageInfo, PageSnapshot } from './types'
import { isPageInfo, isPageSnapshot, isRecord } from './guards'
import { isDictionaryResult, isFileSearchApiResult, isFileSearchQuery, isHistoryDetailResult, isHistoryListResult, isSessionResult } from '../api/message-guards'
import type { DictionaryLoadRequest, DictionarySnapshot } from '../api/dictionaries'
import type { FileSearchQuery } from '../api/file-search-params'
import type { FileSearchResult } from '../api/file-search-types'
import type { HistoryQueryDetail, HistoryQueryOption } from '../api/query-history'
import type { SessionSummary } from '../api/session'
import type { ApiResult } from '../api/types'

/** 所有通道共享的 JSON 消息信封；具体消息使用下方的可辨识联合类型。 */
export interface Message<TPayload = unknown> {
  type: string
  payload?: TPayload
}

export const MessageType = {
  ScanPage: 'SCAN_PAGE',
  ScanResult: 'SCAN_RESULT',
  GetPageInfo: 'GET_PAGE_INFO',
  PageInfo: 'PAGE_INFO',
  ShowPanel: 'SHOW_PANEL',
  PanelShown: 'PANEL_SHOWN',
  Ping: 'PING',
  Pong: 'PONG',
  CheckSession: 'CHECK_SESSION',
  SessionResult: 'SESSION_RESULT',
  CancelSessionCheck: 'CANCEL_SESSION_CHECK',
  SessionCheckCancelled: 'SESSION_CHECK_CANCELLED',
  SearchFiles: 'SEARCH_FILES',
  SearchFilesResult: 'SEARCH_FILES_RESULT',
  CancelFileSearch: 'CANCEL_FILE_SEARCH',
  FileSearchCancelled: 'FILE_SEARCH_CANCELLED',
  ListHistoryQueries: 'LIST_HISTORY_QUERIES',
  HistoryQueriesResult: 'HISTORY_QUERIES_RESULT',
  GetHistoryQuery: 'GET_HISTORY_QUERY',
  HistoryQueryResult: 'HISTORY_QUERY_RESULT',
  LoadDictionary: 'LOAD_DICTIONARY',
  DictionaryResult: 'DICTIONARY_RESULT',
  Error: 'ERROR'
} as const

type Request<T extends string> = Message<undefined> & { type: T }
type Response<T extends string, P> = Message<P> & { type: T; payload: P }

export type ContentRequest =
  | Request<'SCAN_PAGE'> | Request<'GET_PAGE_INFO'> | Request<'SHOW_PANEL'> | Request<'PING'>
  | Request<'CHECK_SESSION'> | Request<'CANCEL_SESSION_CHECK'>
  | Request<'CANCEL_FILE_SEARCH'> | Response<'SEARCH_FILES', { query: FileSearchQuery }>
  | Response<'LIST_HISTORY_QUERIES', { force: boolean }>
  | Response<'GET_HISTORY_QUERY', { queryId: string }>
  | Response<'LOAD_DICTIONARY', DictionaryLoadRequest>
export type ErrorMessage = Response<'ERROR', { message: string }>
export type BackgroundRequest = Request<'PING'>
export type BackgroundResponse = Response<'PONG', { ok: true }> | ErrorMessage
export type ContentResponse =
  | Response<'SCAN_RESULT', PageSnapshot>
  | Response<'PAGE_INFO', PageInfo>
  | Response<'PANEL_SHOWN', { ok: true }>
  | Response<'SESSION_RESULT', ApiResult<SessionSummary>>
  | Response<'SESSION_CHECK_CANCELLED', { ok: true }>
  | Response<'SEARCH_FILES_RESULT', ApiResult<FileSearchResult>>
  | Response<'FILE_SEARCH_CANCELLED', { ok: true }>
  | Response<'HISTORY_QUERIES_RESULT', ApiResult<HistoryQueryOption[]>>
  | Response<'HISTORY_QUERY_RESULT', ApiResult<HistoryQueryDetail>>
  | Response<'DICTIONARY_RESULT', ApiResult<DictionarySnapshot>>
  | BackgroundResponse
export type AppMessage = ContentRequest | ContentResponse

/** 先校验未知值，再缩窄类型，避免把畸形负载当成合法扫描结果。 */
export function isMessage(value: unknown): value is AppMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case MessageType.ScanPage:
    case MessageType.GetPageInfo:
    case MessageType.ShowPanel:
    case MessageType.Ping:
    case MessageType.CheckSession:
    case MessageType.CancelSessionCheck:
    case MessageType.CancelFileSearch:
      return value.payload === undefined
    case MessageType.ListHistoryQueries:
      return isRecord(value.payload) && (value.payload.force === true || value.payload.force === false) &&
        Object.keys(value.payload).length === 1
    case MessageType.GetHistoryQuery:
      return isRecord(value.payload) && typeof value.payload.queryId === 'string' && Object.keys(value.payload).length === 1
    case MessageType.LoadDictionary:
      return isDictionaryRequest(value.payload)
    case MessageType.SearchFiles:
      return isRecord(value.payload) && isFileSearchQuery(value.payload.query) &&
        Object.keys(value.payload).length === 1
    case MessageType.ScanResult:
      return isPageSnapshot(value.payload)
    case MessageType.PageInfo:
      return isPageInfo(value.payload)
    case MessageType.PanelShown:
    case MessageType.Pong:
    case MessageType.SessionCheckCancelled:
    case MessageType.FileSearchCancelled:
      return isRecord(value.payload) && value.payload.ok === true
    case MessageType.SessionResult:
      return isSessionResult(value.payload)
    case MessageType.SearchFilesResult:
      return isFileSearchApiResult(value.payload)
    case MessageType.HistoryQueriesResult:
      return isHistoryListResult(value.payload)
    case MessageType.HistoryQueryResult:
      return isHistoryDetailResult(value.payload)
    case MessageType.DictionaryResult:
      return isDictionaryResult(value.payload)
    case MessageType.Error:
      return isRecord(value.payload) && typeof value.payload.message === 'string'
    default:
      return false
  }
}

export function isContentRequest(value: unknown): value is ContentRequest {
  return isMessage(value) && (
    value.type === MessageType.ScanPage || value.type === MessageType.GetPageInfo ||
    value.type === MessageType.ShowPanel || value.type === MessageType.Ping ||
    value.type === MessageType.CheckSession || value.type === MessageType.CancelSessionCheck ||
    value.type === MessageType.SearchFiles || value.type === MessageType.CancelFileSearch ||
    value.type === MessageType.ListHistoryQueries || value.type === MessageType.GetHistoryQuery ||
    value.type === MessageType.LoadDictionary
  )
}

const DICTIONARY_KINDS = new Set(['basic', 'flow', 'fieldColumn', 'listColumn', 'fileType'])

function isDictionaryRequest(value: unknown): value is DictionaryLoadRequest {
  if (!isRecord(value) || (value.force !== true && value.force !== false) || typeof value.kind !== 'string' || !DICTIONARY_KINDS.has(value.kind)) {
    return false
  }
  if (value.kind === 'fileType') {
    return typeof value.caseTypeId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.caseTypeId) &&
      Object.keys(value).length === 3
  }
  return Object.keys(value).length === 2
}

/** 浮窗和 Content Script 同处隔离环境，通过依赖注入收发消息。 */
export interface MessageBridge {
  request(message: ContentRequest, signal?: AbortSignal): Promise<ContentResponse>
}

