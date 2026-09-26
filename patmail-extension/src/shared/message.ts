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
  RestoreWorkflow: 'RESTORE_WORKFLOW',
  DiagnoseExistingMail: 'DIAGNOSE_EXISTING_MAIL',
  ExistingMailDiagnostic: 'EXISTING_MAIL_DIAGNOSTIC',
  ClaimExecution: 'CLAIM_EXECUTION',
  MarkExecutionPrepared: 'MARK_EXECUTION_PREPARED',
  MarkExecutionSent: 'MARK_EXECUTION_SENT',
  MarkExecutionResponse: 'MARK_EXECUTION_RESPONSE',
  MarkExecutionVerified: 'MARK_EXECUTION_VERIFIED',
  CompleteExecution: 'COMPLETE_EXECUTION',
  ReleaseExecution: 'RELEASE_EXECUTION',
  MarkExecutionUnknown: 'MARK_EXECUTION_UNKNOWN',
  ExecutionLease: 'EXECUTION_LEASE',
  RecoverExecution: 'RECOVER_EXECUTION',
  ExecutionRecovered: 'EXECUTION_RECOVERED',
  ListTasks: 'LIST_TASKS',
  GetTask: 'GET_TASK',
  SaveTask: 'SAVE_TASK',
  ArchiveTask: 'ARCHIVE_TASK',
  ValidateTaskMetadata: 'VALIDATE_TASK_METADATA',
  TaskResult: 'TASK_RESULT',
  SaveAcceptance: 'SAVE_ACCEPTANCE',
  ListAcceptance: 'LIST_ACCEPTANCE',
  AcceptanceResult: 'ACCEPTANCE_RESULT',
  SaveEvidence: 'SAVE_EVIDENCE',
  ListEvidence: 'LIST_EVIDENCE',
  EvidenceResult: 'EVIDENCE_RESULT',
  RunReadonlyAcceptance: 'RUN_READONLY_ACCEPTANCE',
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
  | Response<'RESTORE_WORKFLOW', { mailId: string }>
  | Response<'DIAGNOSE_EXISTING_MAIL', { mailId: string; flowType: string }>
  | Response<'RUN_READONLY_ACCEPTANCE', { call: string; expected: Record<string, string> }>
export type ErrorMessage = Response<'ERROR', { message: string }>
export interface ExistingMailDiagnostic {
  mailId: string
  fileIds: string[]
  fileNames: string[]
  writesAttempted: false
  blockers: string[]
  workflow: WorkflowView
}
export interface ExecutionLeasePayload {
  ok: boolean
  reason: string
  lease: { executionId: string; taskFingerprint: string; owner: string; status: string; requestSent: boolean; easyMailId: string } | null
}
export type BackgroundRequest =
  | Request<'PING'>
  | Response<'CLAIM_EXECUTION', { origin: string; operatorId: string; taskFingerprint: string }>
  | Response<'MARK_EXECUTION_PREPARED', LeaseCommand>
  | Response<'MARK_EXECUTION_SENT', LeaseCommand>
  | Response<'MARK_EXECUTION_RESPONSE', LeaseCommand>
  | Response<'MARK_EXECUTION_VERIFIED', LeaseCommand>
  | Response<'COMPLETE_EXECUTION', LeaseCommand>
  | Response<'RELEASE_EXECUTION', LeaseCommand>
  | Response<'MARK_EXECUTION_UNKNOWN', LeaseCommand>
  | Response<'RECOVER_EXECUTION', { origin: string; operatorId: string }>
  | Response<'LIST_TASKS', { origin: string; operatorId: string }>
  | Response<'GET_TASK', { origin: string; operatorId: string; taskId: string }>
  | Response<'SAVE_TASK', { task: Record<string, unknown> }>
  | Response<'ARCHIVE_TASK', { origin: string; operatorId: string; taskId: string }>
  | Response<'VALIDATE_TASK_METADATA', { origin: string; operatorId: string; taskId: string }>
  | Response<'SAVE_ACCEPTANCE', { record: Record<string, unknown> }>
  | Response<'LIST_ACCEPTANCE', { origin: string; operatorId: string }>
  | Response<'SAVE_EVIDENCE', { record: Record<string, unknown> }>
  | Response<'LIST_EVIDENCE', { origin: string; call: string }>
export type BackgroundResponse =
  | Response<'PONG', { ok: true }>
  | Response<'EXECUTION_LEASE', ExecutionLeasePayload>
  | Response<'EXECUTION_RECOVERED', { leases: ExecutionLeasePayload['lease'][] }>
  | Response<'TASK_RESULT', { ok: boolean; message: string; tasks: TaskSummary[]; task: Record<string, unknown> | null }>
  | Response<'ACCEPTANCE_RESULT', { records: Record<string, unknown>[] }>
  | Response<'EVIDENCE_RESULT', { records: Record<string, unknown>[] }>
  | ErrorMessage

export interface LeaseCommand {
  origin: string
  operatorId: string
  taskFingerprint: string
  executionId: string
  leaseVersion: number
}

export interface TaskSummary {
  taskId: string
  createdAt: string
  customerName: string
  fileCount: number
  mailCount: number
  status: string
  verifiedAt: string
  updatedAt: string
}
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
  | Response<'WORKFLOW_RESULT', { view: WorkflowView | null }>
  | Response<'EXISTING_MAIL_DIAGNOSTIC', ExistingMailDiagnostic>
  | BackgroundResponse
export type AppMessage = ContentRequest | ContentResponse | BackgroundRequest

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
    case MessageType.RestoreWorkflow:
      return isRecord(value.payload) && isFlowId(value.payload.mailId) && Object.keys(value.payload).length === 1
    case MessageType.DiagnoseExistingMail:
      return isRecord(value.payload) && isFlowId(value.payload.mailId) && isFlowType(value.payload.flowType) &&
        Object.keys(value.payload).length === 2
    case MessageType.RunReadonlyAcceptance:
      return isReadonlyProbe(value.payload)
    case MessageType.ClaimExecution:
      return isClaim(value.payload)
    case MessageType.MarkExecutionPrepared:
    case MessageType.MarkExecutionSent:
    case MessageType.MarkExecutionResponse:
    case MessageType.MarkExecutionVerified:
    case MessageType.CompleteExecution:
    case MessageType.ReleaseExecution:
    case MessageType.MarkExecutionUnknown:
      return isLeaseCommand(value.payload)
    case MessageType.RecoverExecution:
    case MessageType.ListTasks:
    case MessageType.ListAcceptance:
      return isOperatorScope(value.payload)
    case MessageType.GetTask:
    case MessageType.ArchiveTask:
    case MessageType.ValidateTaskMetadata:
      return isTaskAddress(value.payload)
    case MessageType.SaveTask:
      return isRecord(value.payload) && isStoredTask(value.payload.task) && Object.keys(value.payload).length === 1
    case MessageType.SaveAcceptance:
    case MessageType.SaveEvidence:
      return isRecord(value.payload) && isPlainRecord(value.payload.record) && Object.keys(value.payload).length === 1
    case MessageType.ListEvidence:
      return isRecord(value.payload) && typeof value.payload.origin === 'string' && typeof value.payload.call === 'string' &&
        value.payload.origin.length <= 200 && value.payload.call.length <= 80 && Object.keys(value.payload).length === 2
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
      return isRecord(value.payload) && Object.keys(value.payload).length === 1 &&
        (value.payload.view === null || isWorkflowView(value.payload.view))
    case MessageType.ExistingMailDiagnostic:
      return isExistingMailDiagnostic(value.payload)
    case MessageType.ExecutionLease:
      return isRecord(value.payload) && typeof value.payload.ok === 'boolean' && typeof value.payload.reason === 'string' &&
        (value.payload.lease === null || isLeaseSummary(value.payload.lease))
    case MessageType.ExecutionRecovered:
      return isRecord(value.payload) && Array.isArray(value.payload.leases) && value.payload.leases.every(item => item === null || isLeaseSummary(item))
    case MessageType.TaskResult:
      return isRecord(value.payload) && typeof value.payload.ok === 'boolean' && typeof value.payload.message === 'string' &&
        Array.isArray(value.payload.tasks) && value.payload.tasks.every(isTaskSummary) &&
        (value.payload.task === null || isStoredTask(value.payload.task))
    case MessageType.AcceptanceResult:
    case MessageType.EvidenceResult:
      return isRecord(value.payload) && Array.isArray(value.payload.records) && value.payload.records.every(isPlainRecord)
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
    value.type === MessageType.RefreshWorkflow || value.type === MessageType.PreviewWorkflow ||
    value.type === MessageType.RestoreWorkflow || value.type === MessageType.DiagnoseExistingMail ||
    value.type === MessageType.RunReadonlyAcceptance
  )
}

function isOperatorScope(value: unknown): value is { origin: string; operatorId: string } {
  return isRecord(value) && typeof value.origin === 'string' && value.origin.length > 0 && value.origin.length <= 200 &&
    typeof value.operatorId === 'string' && value.operatorId.length <= 80 && Object.keys(value).length === 2
}

function isTaskAddress(value: unknown): boolean {
  if (!isRecord(value) || typeof value.taskId !== 'string' || value.taskId.length > 80 || Object.keys(value).length !== 3) return false
  return typeof value.origin === 'string' && typeof value.operatorId === 'string' && isOperatorScope({ origin: value.origin, operatorId: value.operatorId })
}

function isLeaseCommand(value: unknown): value is LeaseCommand {
  return isRecord(value) && typeof value.origin === 'string' && value.origin.length <= 200 &&
    typeof value.operatorId === 'string' && value.operatorId.length <= 80 &&
    typeof value.taskFingerprint === 'string' && value.taskFingerprint.length > 0 && value.taskFingerprint.length <= 128 &&
    typeof value.executionId === 'string' && value.executionId.length <= 80 &&
    typeof value.leaseVersion === 'number' && Number.isInteger(value.leaseVersion) &&
    Object.keys(value).length === 5
}

function isStoredTask(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && typeof value.taskId === 'string' && typeof value.operatorId === 'string' &&
    typeof value.origin === 'string' && typeof value.taskFingerprint === 'string' && Array.isArray(value.items)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).join(',')
  return !/cookie|authorization|password|token/i.test(keys)
}

function isTaskSummary(value: unknown): boolean {
  return isRecord(value) && typeof value.taskId === 'string' && typeof value.customerName === 'string' &&
    typeof value.status === 'string' && typeof value.createdAt === 'string' && typeof value.fileCount === 'number' &&
    typeof value.mailCount === 'number'
}

function isReadonlyProbe(value: unknown): boolean {
  return isRecord(value) && typeof value.call === 'string' && value.call.length <= 80 &&
    isRecord(value.expected) && Object.values(value.expected).every(item => typeof item === 'string') &&
    Object.keys(value.expected).length <= 20 && Object.keys(value).length === 2
}

function isClaim(value: unknown): value is { origin: string; operatorId: string; taskFingerprint: string } {
  return isRecord(value) && typeof value.origin === 'string' && value.origin.length > 0 && value.origin.length <= 200 &&
    typeof value.operatorId === 'string' && value.operatorId.length <= 80 &&
    typeof value.taskFingerprint === 'string' && value.taskFingerprint.length > 0 && value.taskFingerprint.length <= 20000 &&
    Object.keys(value).length === 3
}

function isLeaseSummary(value: unknown): boolean {
  return isRecord(value) && typeof value.executionId === 'string' && typeof value.taskFingerprint === 'string' &&
    typeof value.owner === 'string' && typeof value.status === 'string' && typeof value.requestSent === 'boolean' &&
    typeof value.easyMailId === 'string'
}

function isExistingMailDiagnostic(value: unknown): value is ExistingMailDiagnostic {
  return isRecord(value) && typeof value.mailId === 'string' && Array.isArray(value.fileIds) && value.fileIds.every(item => typeof item === 'string') &&
    Array.isArray(value.fileNames) && value.fileNames.every(item => typeof item === 'string') && value.writesAttempted === false &&
    Array.isArray(value.blockers) && value.blockers.every(item => typeof item === 'string') && isWorkflowView(value.workflow) &&
    Object.keys(value).length === 6
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

