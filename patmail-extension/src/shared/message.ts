import type { PageInfo, PageSnapshot } from './types'
import { isPageInfo, isPageSnapshot, isRecord } from './guards'
import { isDictionaryResult, isFileSearchApiResult, isFileSearchQuery, isHistoryDetailResult, isHistoryListResult, isSessionResult } from '../api/message-guards'
import type { DictionaryLoadRequest, DictionarySnapshot } from '../api/dictionaries'
import type { FileSearchQuery } from '../api/file-search-params'
import type { FileSearchResult } from '../api/file-search-types'
import type { HistoryQueryDetail, HistoryQueryOption } from '../api/query-history'
import type { SessionSummary } from '../api/session'
import type { ApiResult } from '../api/types'
import { isMailDraftPreview, isMailExecutionView, isSelectionClaim } from '../mail/easy/guards'
import type { SelectionClaim } from '../mail/easy/runtime'
import type { MailDraftPreview } from '../mail/types'
import type { MailExecutionView } from '../mail/easy/types'
import { isWorkflowView } from '../workflow/guards'
import type { WorkflowView } from '../workflow/types'

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
  CreateEasyMail: 'CREATE_EASY_MAIL',
  SaveEasyMail: 'SAVE_EASY_MAIL',
  FindMailExecution: 'FIND_MAIL_EXECUTION',
  InspectEasyMail: 'INSPECT_EASY_MAIL',
  MailExecutionResult: 'MAIL_EXECUTION_RESULT',
  ReadWorkflow: 'READ_WORKFLOW',
  RefreshWorkflow: 'REFRESH_WORKFLOW',
  PreviewWorkflow: 'PREVIEW_WORKFLOW',
  WorkflowResult: 'WORKFLOW_RESULT',
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
  | Response<'CREATE_EASY_MAIL', { preview: MailDraftPreview; selection: SelectionClaim; confirmed: true }>
  | Response<'SAVE_EASY_MAIL', { executionId: string; preview: MailDraftPreview; selection: SelectionClaim; acknowledgedDigest: string; confirmed: true }>
  | Response<'FIND_MAIL_EXECUTION', { fingerprint: string }>
  | Response<'INSPECT_EASY_MAIL', { executionId: string }>
  | Response<'READ_WORKFLOW', { mailId: string; flowType: string }>
  | Response<'REFRESH_WORKFLOW', { executionId: string }>
  | Response<'PREVIEW_WORKFLOW', { executionId: string; nodeId: string; reviewerId: string; auditType: 'submit' | 'handover'; remark: string; urgencyId: string }>
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
  | Response<'MAIL_EXECUTION_RESULT', { view: MailExecutionView | null }>
  | Response<'WORKFLOW_RESULT', { view: WorkflowView }>
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
    case MessageType.CreateEasyMail:
      return isConfirmedPreview(value.payload) && Object.keys(value.payload).length === 3
    case MessageType.SaveEasyMail:
      return isRecord(value.payload) && value.payload.confirmed === true && typeof value.payload.executionId === 'string' &&
        isSelectionClaim(value.payload.selection) && typeof value.payload.acknowledgedDigest === 'string' &&
        value.payload.acknowledgedDigest.length <= 20000 && isMailDraftPreview(value.payload.preview) &&
        Object.keys(value.payload).length === 5
    case MessageType.ReadWorkflow:
      return isRecord(value.payload) && isFlowId(value.payload.mailId) && isFlowType(value.payload.flowType) &&
        Object.keys(value.payload).length === 2
    case MessageType.RefreshWorkflow:
      return isRecord(value.payload) && typeof value.payload.executionId === 'string' && value.payload.executionId.length <= 80 &&
        Object.keys(value.payload).length === 1
    case MessageType.PreviewWorkflow:
      return isWorkflowPreview(value.payload)
    case MessageType.FindMailExecution:
      return isRecord(value.payload) && typeof value.payload.fingerprint === 'string' && value.payload.fingerprint.length <= 20000 &&
        Object.keys(value.payload).length === 1
    case MessageType.InspectEasyMail:
      return isRecord(value.payload) && typeof value.payload.executionId === 'string' && Object.keys(value.payload).length === 1
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
    case MessageType.MailExecutionResult:
      return isRecord(value.payload) && Object.keys(value.payload).length === 1 &&
        (value.payload.view === null || isMailExecutionView(value.payload.view))
    case MessageType.WorkflowResult:
      return isRecord(value.payload) && Object.keys(value.payload).length === 1 && isWorkflowView(value.payload.view)
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
    value.type === MessageType.LoadDictionary || value.type === MessageType.CreateEasyMail ||
    value.type === MessageType.SaveEasyMail || value.type === MessageType.FindMailExecution ||
    value.type === MessageType.InspectEasyMail || value.type === MessageType.ReadWorkflow ||
    value.type === MessageType.RefreshWorkflow || value.type === MessageType.PreviewWorkflow
  )
}

function isConfirmedPreview(value: unknown): value is { preview: MailDraftPreview; selection: SelectionClaim; confirmed: true } {
  return isRecord(value) && value.confirmed === true && isSelectionClaim(value.selection) && isMailDraftPreview(value.preview)
}

function isFlowId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isFlowType(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 20 && /^[A-Za-z0-9_-]+$/.test(value)
}

function isWorkflowPreview(value: unknown): value is { executionId: string; nodeId: string; reviewerId: string; auditType: 'submit' | 'handover'; remark: string; urgencyId: string } {
  if (!isRecord(value) || Object.keys(value).length !== 6) return false
  return typeof value.executionId === 'string' && typeof value.nodeId === 'string' && typeof value.reviewerId === 'string' &&
    (value.auditType === 'submit' || value.auditType === 'handover') && typeof value.remark === 'string' && value.remark.length <= 2000 &&
    typeof value.urgencyId === 'string' && value.nodeId.length <= 80 && value.reviewerId.length <= 80 && value.urgencyId.length <= 80
}

const DICTIONARY_KINDS = new Set(['basic', 'flow', 'fieldColumn', 'listColumn', 'fileType', 'mailType'])

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

