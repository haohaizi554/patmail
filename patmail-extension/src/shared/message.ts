import type { PageInfo, PageSnapshot } from './types'
import { isPageInfo, isPageSnapshot, isRecord } from './guards'
import { isEasyOrigin } from '../api/config'
import { isCustomerProfile } from '../customer/guards'
import type { CustomerQueryProfile } from '../customer/types'
import type { MailRuleBundle } from '../mail/types'
import { isQueryGuid, isQueryTemplate } from '../query/query-validator'
import type { QueryTemplate } from '../query/query-types'
import { isEasyConnection, type EasyConnectionContext, type EasyTabCandidate, type ExpectedAccountScope } from './connection'
import { isCaseContactResult, isDictionaryResult, isFileSearchApiResult, isFileSearchQuery, isHistoryDetailResult, isHistoryListResult, isHistorySaveResult, isLimitMonitorApiResult, isLimitMonitorQuery, isMailProcessApiResult, isMailProcessQuery, isSessionResult, isVolumeList } from '../api/message-guards'
import type { LimitMonitorQuery } from '../api/limit-monitor-params'
import { isProcessOpenTarget, type ProcessListQuery, type ProcessListResult, type ProcessOpenTarget } from '../api/mail-process'
import type { CaseContactExport } from '../case-contact/query'
import type { CaseDemandAsset } from '../mail/easy/case-demand'
import type { CustomerDemandAsset, CustomerDirectoryAsset } from '../customer/customer-page'
import type { MailContactAsset } from '../mail/easy/mail-contacts'
import type { AccountReviewerList } from '../workflow/contracts'
import type { LimitMonitorResult } from '../api/limit-monitor-types'
import type { DictionaryLoadRequest, DictionarySnapshot } from '../api/dictionaries'
import type { FileSearchQuery } from '../api/file-search-params'
import type { FileSearchResult } from '../api/file-search-types'
import type { HistoryQueryDetail, HistoryQueryOption } from '../api/query-history'
import type { SessionSummary } from '../api/session'
import type { ApiResult } from '../api/types'
import { isMailDraftPreview, isMailExecutionView, isSelectionClaim } from '../mail/easy/guards'
import type { SelectionClaim } from '../mail/easy/runtime'
import type { MailDraftPreview, SelectedPatentFile } from '../mail/types'
import type { MailExecutionView } from '../mail/easy/types'
import { isWorkflowView } from '../workflow/guards'
import type { WorkflowView } from '../workflow/types'
import { isWriteSwitchOpen } from '../settings/write-switch'

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
  SearchLimitMonitor: 'SEARCH_LIMIT_MONITOR',
  SearchLimitMonitorResult: 'SEARCH_LIMIT_MONITOR_RESULT',
  SubmitLimitMail: 'SUBMIT_LIMIT_MAIL',
  SubmitLimitMailResult: 'SUBMIT_LIMIT_MAIL_RESULT',
  ExportCaseContacts: 'EXPORT_CASE_CONTACTS',
  ExportCaseContactsResult: 'EXPORT_CASE_CONTACTS_RESULT',
  ListMailProcesses: 'LIST_MAIL_PROCESSES',
  ListMailProcessesResult: 'LIST_MAIL_PROCESSES_RESULT',
  OpenEasyForm: 'OPEN_EASY_FORM',
  OpenEasyFormResult: 'OPEN_EASY_FORM_RESULT',
  ListFlowReviewers: 'LIST_FLOW_REVIEWERS',
  ListFlowReviewersResult: 'LIST_FLOW_REVIEWERS_RESULT',
  ReadCaseDemands: 'READ_CASE_DEMANDS',
  CaseDemandResult: 'CASE_DEMAND_RESULT',
  ReadCaseBusFlow: 'READ_CASE_BUS_FLOW',
  CaseBusFlowResult: 'CASE_BUS_FLOW_RESULT',
  LookupIcFlow: 'LOOKUP_IC_FLOW',
  LookupIcFlowResult: 'LOOKUP_IC_FLOW_RESULT',
  ReadCustomerDemands: 'READ_CUSTOMER_DEMANDS',
  CustomerDemandResult: 'CUSTOMER_DEMAND_RESULT',
  ReadCustomerDirectory: 'READ_CUSTOMER_DIRECTORY',
  CustomerDirectoryResult: 'CUSTOMER_DIRECTORY_RESULT',
  ReadMailContacts: 'READ_MAIL_CONTACTS',
  MailContactResult: 'MAIL_CONTACT_RESULT',
  ReadMailAddresses: 'READ_MAIL_ADDRESSES',
  MailAddressResult: 'MAIL_ADDRESS_RESULT',
  CancelFileSearch: 'CANCEL_FILE_SEARCH',
  FileSearchCancelled: 'FILE_SEARCH_CANCELLED',
  ListHistoryQueries: 'LIST_HISTORY_QUERIES',
  HistoryQueriesResult: 'HISTORY_QUERIES_RESULT',
  GetHistoryQuery: 'GET_HISTORY_QUERY',
  HistoryQueryResult: 'HISTORY_QUERY_RESULT',
  SaveHistoryQuery: 'SAVE_HISTORY_QUERY',
  HistoryQuerySaved: 'HISTORY_QUERY_SAVED',
  LoadDictionary: 'LOAD_DICTIONARY',
  ScanFileSearchForm: 'SCAN_FILE_SEARCH_FORM',
  FileSearchFormResult: 'FILE_SEARCH_FORM_RESULT',
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
  Workspace: 'WORKSPACE',
  WorkspaceResult: 'WORKSPACE_RESULT',
  WorkflowResult: 'WORKFLOW_RESULT',
  Error: 'ERROR'
} as const

type Request<T extends string> = Message<undefined> & { type: T }
type Response<T extends string, P> = Message<P> & { type: T; payload: P }

export type ContentRequest =
  | Request<'SCAN_PAGE'> | Request<'GET_PAGE_INFO'> | Request<'SHOW_PANEL'> | Request<'PING'>
  | Request<'CHECK_SESSION'> | Request<'CANCEL_SESSION_CHECK'>
  | Request<'CANCEL_FILE_SEARCH'> | Response<'SEARCH_FILES', { query: FileSearchQuery; continuation?: { querySessionId: string } }>
  | Response<'SEARCH_LIMIT_MONITOR', { query: LimitMonitorQuery }>
  | Response<'SUBMIT_LIMIT_MAIL', { userId: string; items: Array<{ procId: string; procIds?: string[]; mailTypeId: string; mailStyle: '1'; mailId?: string; mode: 'ipr' | 'lead'; inventor?: boolean; customerName: string; contactName: string; iprName: string; leadName: string }> }>
  | Response<'EXPORT_CASE_CONTACTS', { volumes: string[] }>
  | Response<'LIST_MAIL_PROCESSES', { query: ProcessListQuery }>
  | Response<'OPEN_EASY_FORM', { target: ProcessOpenTarget }>
  | Request<'LIST_FLOW_REVIEWERS'>
  | Response<'READ_CASE_DEMANDS', { caseId: string }>
  | Response<'READ_CASE_BUS_FLOW', { caseId: string; procId: string }>
  | Response<'LOOKUP_IC_FLOW', { rows: Array<{ caseVolume: string; procLabel: string }> }>
  | Response<'READ_CUSTOMER_DEMANDS', { customerId: string }>
  | Response<'READ_CUSTOMER_DIRECTORY', { customerId: string }>
  | Response<'READ_MAIL_CONTACTS', { mailId: string; customerId: string }>
  | Response<'READ_MAIL_ADDRESSES', { mailId: string }>
  | Response<'LIST_HISTORY_QUERIES', { force: boolean; surface?: 'file' | 'limit' }>
  | Response<'GET_HISTORY_QUERY', { queryId: string; surface?: 'file' | 'limit' }>
  | Response<'SAVE_HISTORY_QUERY', { title: string; queryId: string; queryXml: string; surface?: 'file' | 'limit' }>
  | Response<'LOAD_DICTIONARY', DictionaryLoadRequest>
  | Request<'SCAN_FILE_SEARCH_FORM'>
  | Response<'CREATE_EASY_MAIL', { preview: MailDraftPreview; selection: SelectionClaim; confirmed: true }>
  | Response<'SAVE_EASY_MAIL', { executionId: string; preview: MailDraftPreview; selection: SelectionClaim; acknowledgedDigest: string; confirmed: true }>
  | Response<'FIND_MAIL_EXECUTION', { fingerprint: string }>
  | Response<'INSPECT_EASY_MAIL', { executionId: string }>
  | Response<'READ_WORKFLOW', { mailId: string; flowType: string }>
  | Response<'REFRESH_WORKFLOW', { executionId: string }>
  | Response<'PREVIEW_WORKFLOW', { executionId: string; nodeId: string; reviewerId: string; auditType: 'submit' | 'handover'; remark: string; urgencyId: string }>
  | Response<'RESTORE_WORKFLOW', { mailId: string }>
  | Response<'DIAGNOSE_EXISTING_MAIL', { mailId: string; flowType: string }>
  | Response<'RUN_READONLY_ACCEPTANCE', { call: string; expected: Record<string, string>; caseTypeId?: string; mailId?: string; flowType?: string }>
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
  | Response<'WORKSPACE', WorkspaceAction>
export type BackgroundResponse =
  | Response<'PONG', { ok: true }>
  | Response<'EXECUTION_LEASE', ExecutionLeasePayload>
  | Response<'EXECUTION_RECOVERED', { leases: ExecutionLeasePayload['lease'][] }>
  | Response<'TASK_RESULT', { ok: boolean; message: string; tasks: TaskSummary[]; task: Record<string, unknown> | null; currentEvidence?: Record<string, unknown> | null; stagePlans?: Record<string, unknown>[] }>
  | Response<'ACCEPTANCE_RESULT', { records: Record<string, unknown>[]; probe?: { httpStatus: number; sessionOk: boolean; fields: Record<string, string>; shape: string } }>
  | Response<'EVIDENCE_RESULT', { records: Record<string, unknown>[] }>
  | Response<'WORKSPACE_RESULT', WorkspaceResultPayload>
  | ErrorMessage

export interface LeaseCommand {
  origin: string
  operatorId: string
  taskFingerprint: string
  executionId: string
  leaseVersion: number
}

export type WorkspaceAction =
  | { action: 'focus' } | { action: 'listTabs' } | { action: 'refreshSession' } | { action: 'openLogin' } | { action: 'load' }
  | { action: 'bind'; tabId: number }
  | { action: 'saveCustomer'; profile: CustomerQueryProfile; expectedScope: ExpectedAccountScope; expectedRevision?: number }
  | { action: 'deleteCustomer'; id: string; expectedScope: ExpectedAccountScope; expectedRevision: number }
  | { action: 'saveQueryTemplate'; template: QueryTemplate; expectedScope: ExpectedAccountScope; expectedVersion: number | null }
  | { action: 'deleteQueryTemplate'; id: string; expectedScope: ExpectedAccountScope }
  | { action: 'saveRules'; bundle: MailRuleBundle; expectedScope: ExpectedAccountScope }
  | { action: 'createTaskPlan'; files: SelectedPatentFile[]; queryTemplateVersion: number; expectedScope: ExpectedAccountScope }
  | { action: 'forward'; message: ContentRequest }
  | { action: 'runAcceptance'; call: string; caseTypeId?: string; mailId?: string; flowType?: string; expectedFields?: Record<string, string> }

export interface CreatedTaskResult {
  taskId: string
  taskFingerprint: string
  status: string
  createdAt: string
  itemCount: number
  persisted: true
  fileSource: 'FILE_SOURCE_UNVERIFIED' | 'SEARCH_RESPONSE_OBSERVED'
}

export interface WorkspaceResultPayload {
  ok: boolean
  message: string
  connection: EasyConnectionContext
  tabs: EasyTabCandidate[]
  customers: CustomerQueryProfile[]
  templates: QueryTemplate[]
  rules: MailRuleBundle | null
  tasks: TaskSummary[]
  forwarded: AppMessage | null
  appTab: { tabId: number; created: boolean } | null
  createdTask: CreatedTaskResult | null
  contextError?: 'STALE_CONTEXT'
  rulesSaved?: boolean
  tasksRevalidated?: boolean
  pendingRevalidation?: boolean
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
export interface FileSearchFormField {
  id: string
  label: string
  section: 'case' | 'file'
  advanced: boolean
  control: 'text' | 'select' | 'check' | 'picker'
  visible: boolean
  hiddenBy: string[]
  options: { value: string; label: string; parent?: string }[]
}

export type ContentResponse =
  | Response<'SCAN_RESULT', PageSnapshot>
  | Response<'PAGE_INFO', PageInfo>
  | Response<'PANEL_SHOWN', { ok: true }>
  | Response<'SESSION_RESULT', ApiResult<SessionSummary>>
  | Response<'SESSION_CHECK_CANCELLED', { ok: true }>
  | Response<'SEARCH_FILES_RESULT', ApiResult<FileSearchResult>>
  | Response<'SEARCH_LIMIT_MONITOR_RESULT', ApiResult<LimitMonitorResult>>
  | Response<'SUBMIT_LIMIT_MAIL_RESULT', { stopped: boolean; results: Array<{ procId: string; mailId: string; state: 'submitted' | 'created' | 'unknown' | 'failed'; message: string }> }>
  | Response<'EXPORT_CASE_CONTACTS_RESULT', ApiResult<CaseContactExport>>
  | Response<'LIST_MAIL_PROCESSES_RESULT', ApiResult<ProcessListResult>>
  | Response<'OPEN_EASY_FORM_RESULT', { ok: boolean; message: string }>
  | Response<'LIST_FLOW_REVIEWERS_RESULT', ApiResult<AccountReviewerList>>
  | Response<'CASE_DEMAND_RESULT', ApiResult<CaseDemandAsset>>
  | Response<'CASE_BUS_FLOW_RESULT', ApiResult<{ gate: 'open' | 'pending' | 'done' }>>
  | Response<'LOOKUP_IC_FLOW_RESULT', ApiResult<{ items: Array<{ caseVolume: string; procLabel: string; found: boolean; gate: '' | 'open' | 'pending' | 'done' }> }>>
  | Response<'CUSTOMER_DEMAND_RESULT', ApiResult<CustomerDemandAsset>>
  | Response<'CUSTOMER_DIRECTORY_RESULT', ApiResult<CustomerDirectoryAsset>>
  | Response<'MAIL_CONTACT_RESULT', ApiResult<MailContactAsset>>
  | Response<'MAIL_ADDRESS_RESULT', ApiResult<{ to: string; cc: string; customerId: string; caseVolumes: string[] }>>
  | Response<'FILE_SEARCH_CANCELLED', { ok: true }>
  | Response<'HISTORY_QUERIES_RESULT', ApiResult<HistoryQueryOption[]>>
  | Response<'HISTORY_QUERY_RESULT', ApiResult<HistoryQueryDetail>>
  | Response<'HISTORY_QUERY_SAVED', ApiResult<{ saved: true }>>
  | Response<'DICTIONARY_RESULT', ApiResult<DictionarySnapshot>>
  | Response<'FILE_SEARCH_FORM_RESULT', { fields: FileSearchFormField[] }>
  | Response<'MAIL_EXECUTION_RESULT', { view: MailExecutionView | null }>
  | Response<'WORKFLOW_RESULT', { view: WorkflowView | null }>
  | Response<'EXISTING_MAIL_DIAGNOSTIC', ExistingMailDiagnostic>
  | BackgroundResponse
export type AppMessage = ContentRequest | ContentResponse | BackgroundRequest

/** 先校验未知值，再缩窄类型，避免把畸形负载当成合法扫描结果。 */
function isFileSearchFormField(value: unknown): value is FileSearchFormField {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id.length <= 80 &&
    typeof value.label === 'string' && value.label.length <= 80 &&
    (value.section === 'case' || value.section === 'file') &&
    typeof value.advanced === 'boolean' &&
    (value.control === 'text' || value.control === 'select' || value.control === 'check' || value.control === 'picker') &&
    typeof value.visible === 'boolean' &&
    Array.isArray(value.hiddenBy) && value.hiddenBy.length <= 8 && value.hiddenBy.every(item => typeof item === 'string' && item.length <= 160) &&
    Array.isArray(value.options) && value.options.length <= 800 && value.options.every(option => isRecord(option) &&
      typeof option.value === 'string' && option.value.length <= 80 && typeof option.label === 'string' && option.label.length <= 160 &&
      (option.parent === undefined || (typeof option.parent === 'string' && option.parent.length <= 80)))
}

function isCaseDemandAsset(value: unknown): value is CaseDemandAsset {
  if (!isRecord(value) || !isQueryGuid(String(value.caseId)) || typeof value.text !== 'string' || value.text.length > 400_000) return false
  if (typeof value.complete !== 'boolean' || typeof value.message !== 'string' || value.message.length > 400) return false
  if (!Array.isArray(value.rows) || value.rows.length > 500) return false
  return value.rows.every(row => isRecord(row) &&
    typeof row.demandId === 'string' && row.demandId.length <= 80 &&
    typeof row.demandType === 'string' && row.demandType.length <= 20_000 &&
    typeof row.title === 'string' && row.title.length <= 20_000 &&
    typeof row.description === 'string' && row.description.length <= 20_000)
}

function isCaseBusFlowResult(value: unknown): value is ApiResult<{ gate: 'open' | 'pending' | 'done' }> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  return value.ok === true && isRecord(value.data) && (value.data.gate === 'open' || value.data.gate === 'pending' || value.data.gate === 'done') && Object.keys(value.data).length === 1
}

function isIcFlowAsk(value: unknown): value is { caseVolume: string; procLabel: string } {
  return isRecord(value) && typeof value.caseVolume === 'string' && value.caseVolume.trim().length > 0 && value.caseVolume.length <= 80 &&
    typeof value.procLabel === 'string' && value.procLabel.trim().length > 0 && value.procLabel.length <= 80 &&
    Object.keys(value).length === 2
}

function isIcFlowResult(value: unknown): value is ApiResult<{ items: Array<{ caseVolume: string; procLabel: string; found: boolean; gate: '' | 'open' | 'pending' | 'done' }> }> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  if (value.ok !== true || !isRecord(value.data) || !Array.isArray(value.data.items) || value.data.items.length > 300 || Object.keys(value.data).length !== 1) return false
  return value.data.items.every(item => isRecord(item) && typeof item.caseVolume === 'string' && item.caseVolume.length <= 80 &&
    typeof item.procLabel === 'string' && item.procLabel.length <= 80 && typeof item.found === 'boolean' &&
    (item.gate === '' || item.gate === 'open' || item.gate === 'pending' || item.gate === 'done') && Object.keys(item).length === 4)
}

function isCaseDemandResult(value: unknown): value is ApiResult<CaseDemandAsset> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  return value.ok === true && isCaseDemandAsset(value.data)
}

function isCustomerDemandAsset(value: unknown): value is CustomerDemandAsset {
  if (!isRecord(value) || !isQueryGuid(String(value.customerId)) || typeof value.text !== 'string' || value.text.length > 400_000) return false
  if (typeof value.complete !== 'boolean' || typeof value.message !== 'string' || value.message.length > 400) return false
  if (!Array.isArray(value.rows) || value.rows.length > 500) return false
  return value.rows.every(row => isRecord(row) &&
    typeof row.demandId === 'string' && row.demandId.length <= 80 &&
    typeof row.caseType === 'string' && row.caseType.length <= 20_000 &&
    typeof row.demandType === 'string' && row.demandType.length <= 20_000 &&
    typeof row.title === 'string' && row.title.length <= 20_000 &&
    typeof row.description === 'string' && row.description.length <= 20_000 &&
    typeof row.fileName === 'string' && row.fileName.length <= 20_000 &&
    typeof row.disabled === 'boolean')
}

function isCustomerDirectoryAsset(value: unknown): value is CustomerDirectoryAsset {
  if (!isRecord(value) || !isQueryGuid(String(value.customerId))) return false
  if (typeof value.complete !== 'boolean' || typeof value.message !== 'string' || value.message.length > 400) return false
  if (!Array.isArray(value.rows) || value.rows.length > 500) return false
  return value.rows.every(row => isRecord(row) &&
    typeof row.contactId === 'string' && row.contactId.length <= 80 &&
    typeof row.name === 'string' && row.name.length <= 2_000 &&
    typeof row.email === 'string' && row.email.length <= 2_000 &&
    typeof row.contactType === 'string' && row.contactType.length <= 2_000)
}

function isCustomerPageResult<T>(value: unknown, asset: (data: unknown) => data is T): value is ApiResult<T> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  return value.ok === true && asset(value.data)
}

function isOptionalGuid(value: unknown): boolean {
  return typeof value === 'string' && (value === '' || isQueryGuid(value))
}

function isMailContactAsset(value: unknown): value is MailContactAsset {
  if (!isRecord(value) || !isOptionalGuid(value.mailId) || !isOptionalGuid(value.customerId)) return false
  if (typeof value.text !== 'string' || value.text.length > 400_000 || typeof value.complete !== 'boolean') return false
  if (typeof value.message !== 'string' || value.message.length > 400) return false
  if (!Array.isArray(value.rows) || value.rows.length > 500) return false
  const groups = ['recent', 'customer', 'case', 'sales', 'pics', 'agent']
  const rowOk = value.rows.every(row => isRecord(row) && groups.includes(String(row.group)) &&
    typeof row.name === 'string' && row.name.length <= 2_000 &&
    typeof row.email === 'string' && row.email.length <= 2_000 &&
    typeof row.role === 'string' && row.role.length <= 2_000)
  if (!rowOk) return false
  const introducer = value.introducer
  if (introducer === null) return true
  if (!isRecord(introducer)) return false
  return ['name', 'email', 'insideName', 'insideEmail'].every(key => typeof introducer[key] === 'string' && String(introducer[key]).length <= 2_000)
}

function isMailContactResult(value: unknown): value is ApiResult<MailContactAsset> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  return value.ok === true && isMailContactAsset(value.data)
}

function isMailAddressResult(value: unknown): value is ApiResult<{ to: string; cc: string; customerId: string; caseVolumes: string[] }> {
  if (!isRecord(value)) return false
  if (value.ok === false) return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  if (value.ok !== true || !isRecord(value.data)) return false
  const volumes = value.data.caseVolumes
  return typeof value.data.to === 'string' && value.data.to.length <= 20_000 &&
    typeof value.data.cc === 'string' && value.data.cc.length <= 20_000 &&
    isOptionalGuid(value.data.customerId) &&
    Array.isArray(volumes) && volumes.length <= 100 && volumes.every(item => typeof item === 'string' && item.length <= 80)
}

function isAccountReviewerResult(value: unknown): value is ApiResult<AccountReviewerList> {
  if (!isRecord(value)) return false
  if (value.ok === false) {
    return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
  }
  if (value.ok !== true || !isRecord(value.data) || typeof value.data.message !== 'string' || !Array.isArray(value.data.reviewers)) return false
  return value.data.reviewers.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string')
}

function isLimitMailSubmitItem(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  const allowed = ['procId', 'procIds', 'mailTypeId', 'mailStyle', 'mailId', 'mode', 'inventor', 'customerName', 'contactName', 'iprName', 'leadName']
  if (!keys.every(key => allowed.includes(key))) return false
  if (!keys.includes('mode') || !keys.includes('customerName') || !keys.includes('contactName') || !keys.includes('iprName') || !keys.includes('leadName')) return false
  if (value.mode !== 'ipr' && value.mode !== 'lead') return false
  if (value.inventor !== undefined && value.inventor !== true && value.inventor !== false) return false
  if (!isShortText(value.customerName, 120) || !isShortText(value.contactName, 80) || !isShortText(value.iprName, 80) || !isShortText(value.leadName, 80)) return false
  if (!value.iprName.trim()) return false
  if (value.mode === 'lead' && !value.leadName.trim()) return false
  if (!isQueryGuid(String(value.procId)) || !isQueryGuid(String(value.mailTypeId)) || value.mailStyle !== '1') return false
  if (value.mailId !== undefined && !isQueryGuid(String(value.mailId))) return false
  if (value.procIds === undefined) return true
  return Array.isArray(value.procIds) && value.procIds.length > 0 && value.procIds.length <= 500 &&
    value.procIds.every(id => isQueryGuid(String(id))) &&
    value.procIds.some(id => String(id).toLowerCase() === String(value.procId).toLowerCase())
}

function isLimitMailSubmitRequest(value: unknown): boolean {
  if (!isRecord(value) || !isQueryGuid(String(value.userId)) || !Array.isArray(value.items)) return false
  return value.items.length > 0 && value.items.every(isLimitMailSubmitItem) && Object.keys(value).length === 2
}

function isLimitMailSubmitResponse(value: unknown): boolean {
  if (!isRecord(value) || typeof value.stopped !== 'boolean' || !Array.isArray(value.results) || Object.keys(value).length !== 2) return false
  return value.results.every(item => isRecord(item) &&
    typeof item.procId === 'string' && typeof item.mailId === 'string' && typeof item.message === 'string' && item.message.length <= 8000 &&
    (item.state === 'submitted' || item.state === 'created' || item.state === 'unknown' || item.state === 'failed') &&
    Object.keys(item).length === 4)
}

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
        (value.payload.surface === undefined || value.payload.surface === 'file' || value.payload.surface === 'limit') &&
        Object.keys(value.payload).every(key => key === 'force' || key === 'surface')
    case MessageType.GetHistoryQuery:
      return isRecord(value.payload) && typeof value.payload.queryId === 'string' &&
        (value.payload.surface === undefined || value.payload.surface === 'file' || value.payload.surface === 'limit') &&
        Object.keys(value.payload).every(key => key === 'queryId' || key === 'surface')
    case MessageType.SaveHistoryQuery:
      return isRecord(value.payload) && typeof value.payload.title === 'string' && value.payload.title.trim().length > 0 &&
        value.payload.title.length <= 80 && typeof value.payload.queryId === 'string' &&
        (value.payload.queryId === '' || isQueryGuid(value.payload.queryId)) &&
        typeof value.payload.queryXml === 'string' && value.payload.queryXml.length <= 200_000 &&
        value.payload.queryXml.startsWith('<xmlRoot>') && value.payload.queryXml.endsWith('</xmlRoot>') &&
        !/<!DOCTYPE|<!ENTITY/i.test(value.payload.queryXml) &&
        (value.payload.surface === undefined || value.payload.surface === 'file' || value.payload.surface === 'limit') &&
        Object.keys(value.payload).every(key => key === 'title' || key === 'queryId' || key === 'queryXml' || key === 'surface')
    case MessageType.LoadDictionary:
      return isDictionaryRequest(value.payload)
    case MessageType.ScanFileSearchForm:
    case MessageType.ListFlowReviewers:
      return value.payload === undefined
    case MessageType.ReadCaseDemands:
      return isRecord(value.payload) && isQueryGuid(String(value.payload.caseId)) && Object.keys(value.payload).length === 1
    case MessageType.ReadCaseBusFlow:
      return isRecord(value.payload) && isQueryGuid(String(value.payload.caseId)) && isQueryGuid(String(value.payload.procId)) && Object.keys(value.payload).length === 2
    case MessageType.LookupIcFlow:
      return isRecord(value.payload) && Array.isArray(value.payload.rows) && value.payload.rows.length > 0 && value.payload.rows.length <= 40 &&
        value.payload.rows.every(isIcFlowAsk) && Object.keys(value.payload).length === 1
    case MessageType.ReadCustomerDemands:
    case MessageType.ReadCustomerDirectory:
      return isRecord(value.payload) && isQueryGuid(String(value.payload.customerId)) && Object.keys(value.payload).length === 1
    case MessageType.ReadMailContacts:
      return isRecord(value.payload) && isOptionalGuid(value.payload.mailId) && isOptionalGuid(value.payload.customerId) && Object.keys(value.payload).length === 2
    case MessageType.ReadMailAddresses:
      return isRecord(value.payload) && isQueryGuid(String(value.payload.mailId)) && Object.keys(value.payload).length === 1
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
    case MessageType.Workspace:
      return isWorkspaceAction(value.payload)
    case MessageType.WorkspaceResult:
      return isWorkspaceResult(value.payload)
    case MessageType.PreviewWorkflow:
      return isWorkflowPreview(value.payload)
    case MessageType.FindMailExecution:
      return isRecord(value.payload) && typeof value.payload.fingerprint === 'string' && value.payload.fingerprint.length <= 20000 &&
        Object.keys(value.payload).length === 1
    case MessageType.InspectEasyMail:
      return isRecord(value.payload) && typeof value.payload.executionId === 'string' && Object.keys(value.payload).length === 1
    case MessageType.SearchFiles:
      return isRecord(value.payload) && isFileSearchQuery(value.payload.query) && isSearchContinuation(value.payload.continuation) &&
        (Object.keys(value.payload).length === 1 || (Object.keys(value.payload).length === 2 && value.payload.continuation !== undefined))
    case MessageType.SearchLimitMonitor:
      return isRecord(value.payload) && isLimitMonitorQuery(value.payload.query) && Object.keys(value.payload).length === 1
    case MessageType.SubmitLimitMail:
      return isLimitMailSubmitRequest(value.payload)
    case MessageType.SubmitLimitMailResult:
      return isLimitMailSubmitResponse(value.payload)
    case MessageType.ExportCaseContacts:
      return isRecord(value.payload) && isVolumeList(value.payload.volumes) && Object.keys(value.payload).length === 1
    case MessageType.ListMailProcesses:
      return isRecord(value.payload) && isMailProcessQuery(value.payload.query) && Object.keys(value.payload).length === 1
    case MessageType.OpenEasyForm:
      return isRecord(value.payload) && isProcessOpenTarget(value.payload.target) && Object.keys(value.payload).length === 1
    case MessageType.OpenEasyFormResult:
      return isRecord(value.payload) && typeof value.payload.ok === 'boolean' && typeof value.payload.message === 'string' &&
        value.payload.message.length <= 200 && Object.keys(value.payload).length === 2
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
    case MessageType.SearchLimitMonitorResult:
      return isLimitMonitorApiResult(value.payload)
    case MessageType.ExportCaseContactsResult:
      return isCaseContactResult(value.payload)
    case MessageType.ListMailProcessesResult:
      return isMailProcessApiResult(value.payload)
    case MessageType.ListFlowReviewersResult:
      return isAccountReviewerResult(value.payload)
    case MessageType.CaseDemandResult:
      return isCaseDemandResult(value.payload)
    case MessageType.CaseBusFlowResult:
      return isCaseBusFlowResult(value.payload)
    case MessageType.LookupIcFlowResult:
      return isIcFlowResult(value.payload)
    case MessageType.CustomerDemandResult:
      return isCustomerPageResult(value.payload, isCustomerDemandAsset)
    case MessageType.CustomerDirectoryResult:
      return isCustomerPageResult(value.payload, isCustomerDirectoryAsset)
    case MessageType.MailContactResult:
      return isMailContactResult(value.payload)
    case MessageType.MailAddressResult:
      return isMailAddressResult(value.payload)
    case MessageType.HistoryQueriesResult:
      return isHistoryListResult(value.payload)
    case MessageType.HistoryQueryResult:
      return isHistoryDetailResult(value.payload)
    case MessageType.HistoryQuerySaved:
      return isHistorySaveResult(value.payload)
    case MessageType.DictionaryResult:
      return isDictionaryResult(value.payload)
    case MessageType.FileSearchFormResult:
      return isRecord(value.payload) && Array.isArray(value.payload.fields) && value.payload.fields.length <= 200 &&
        value.payload.fields.every(isFileSearchFormField) && Object.keys(value.payload).length === 1
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
    value.type === MessageType.SearchLimitMonitor || value.type === MessageType.ListMailProcesses ||
    value.type === MessageType.SubmitLimitMail ||
    value.type === MessageType.ExportCaseContacts ||
    value.type === MessageType.OpenEasyForm ||
    value.type === MessageType.ListFlowReviewers ||
    value.type === MessageType.ReadCaseDemands ||
    value.type === MessageType.ReadCaseBusFlow ||
    value.type === MessageType.LookupIcFlow ||
    value.type === MessageType.ReadCustomerDemands ||
    value.type === MessageType.ReadCustomerDirectory ||
    value.type === MessageType.ReadMailContacts ||
    value.type === MessageType.ReadMailAddresses ||
    value.type === MessageType.ListHistoryQueries || value.type === MessageType.GetHistoryQuery ||
    value.type === MessageType.SaveHistoryQuery ||
    value.type === MessageType.LoadDictionary || value.type === MessageType.ScanFileSearchForm || value.type === MessageType.CreateEasyMail ||
    value.type === MessageType.SaveEasyMail || value.type === MessageType.FindMailExecution ||
    value.type === MessageType.InspectEasyMail || value.type === MessageType.ReadWorkflow ||
    value.type === MessageType.RefreshWorkflow || value.type === MessageType.PreviewWorkflow ||
    value.type === MessageType.RestoreWorkflow || value.type === MessageType.DiagnoseExistingMail ||
    value.type === MessageType.RunReadonlyAcceptance
  )
}

const PAGE_FORWARD = new Set(['CHECK_SESSION', 'CANCEL_SESSION_CHECK', 'SEARCH_FILES', 'CANCEL_FILE_SEARCH', 'SEARCH_LIMIT_MONITOR', 'LOOKUP_IC_FLOW', 'EXPORT_CASE_CONTACTS', 'LIST_MAIL_PROCESSES', 'OPEN_EASY_FORM', 'LIST_FLOW_REVIEWERS', 'READ_CASE_DEMANDS', 'READ_CASE_BUS_FLOW', 'READ_CUSTOMER_DEMANDS', 'READ_CUSTOMER_DIRECTORY', 'READ_MAIL_CONTACTS', 'READ_MAIL_ADDRESSES', 'GET_PAGE_INFO', 'LIST_HISTORY_QUERIES', 'GET_HISTORY_QUERY', 'LOAD_DICTIONARY', 'SCAN_FILE_SEARCH_FORM', 'FIND_MAIL_EXECUTION', 'INSPECT_EASY_MAIL', 'READ_WORKFLOW', 'REFRESH_WORKFLOW', 'PREVIEW_WORKFLOW', 'DIAGNOSE_EXISTING_MAIL', 'RUN_READONLY_ACCEPTANCE'])
const WRITE_FORWARD = new Set(['CREATE_EASY_MAIL', 'SAVE_EASY_MAIL', 'SAVE_HISTORY_QUERY', 'SUBMIT_LIMIT_MAIL'])

/** 不允许转发时给出原因。写开关关掉时，创建、保存和查询模板写回都停在这里。 */
export function workspaceForwardBlock(value: unknown): string {
  if (!isContentRequest(value)) return '完整页面不能转发这个请求。'
  if (PAGE_FORWARD.has(value.type)) return ''
  if (WRITE_FORWARD.has(value.type)) return isWriteSwitchOpen() ? '' : '写开关已关闭。'
  return '完整页面不能转发这个请求。'
}

/** 消息校验和后台派发共用同一份许可。创建、保存和查询模板写回还要看前端写开关。 */
export function isWorkspaceForwardRequest(value: unknown): value is ContentRequest {
  return workspaceForwardBlock(value) === ''
}

function isSearchContinuation(value: unknown): boolean {
  if (value === undefined) return true
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.querySessionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.querySessionId)
}

function isExpectedScope(value: unknown): value is ExpectedAccountScope {
  return isRecord(value) && typeof value.easyOrigin === 'string' && isEasyOrigin(value.easyOrigin) && typeof value.operatorId === 'string' && isQueryGuid(value.operatorId) &&
    typeof value.easyTabId === 'number' && Number.isInteger(value.easyTabId) &&
    typeof value.connectionVersion === 'number' && Number.isInteger(value.connectionVersion) && value.connectionVersion >= 0
}

function isPlanFiles(value: unknown): value is SelectedPatentFile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return false
  return value.every(item => isRecord(item) && typeof item.fileId === 'string' && item.fileId.trim().length > 0 && item.fileId.length <= 200 &&
    typeof item.fileName === 'string' && item.fileName.length <= 300)
}

function isWorkspaceAction(value: unknown): value is WorkspaceAction {
  if (!isRecord(value) || typeof value.action !== 'string') return false
  if (value.action === 'focus' || value.action === 'listTabs' || value.action === 'refreshSession' || value.action === 'openLogin' || value.action === 'load') {
    return Object.keys(value).length === 1
  }
  if (value.action === 'bind') return typeof value.tabId === 'number' && Number.isInteger(value.tabId) && Object.keys(value).length === 2
  if (value.action === 'saveCustomer') {
    const keys = Object.keys(value)
    const revisionOk = value.expectedRevision === undefined || (Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 1)
    return isCustomerProfile(value.profile) && isExpectedScope(value.expectedScope) && revisionOk && (keys.length === 3 || keys.length === 4)
  }
  if (value.action === 'deleteCustomer') {
    return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 80 && isExpectedScope(value.expectedScope) &&
      Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 1 && Object.keys(value).length === 4
  }
  if (value.action === 'saveQueryTemplate') {
    const versionOk = value.expectedVersion === null || (Number.isSafeInteger(value.expectedVersion) && Number(value.expectedVersion) >= 1)
    return isQueryTemplate(value.template) && isExpectedScope(value.expectedScope) && versionOk && Object.keys(value).length === 4
  }
  if (value.action === 'deleteQueryTemplate') {
    return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 80 && isExpectedScope(value.expectedScope) && Object.keys(value).length === 3
  }
  if (value.action === 'saveRules') return isRuleBundle(value.bundle) && isExpectedScope(value.expectedScope) && Object.keys(value).length === 3
  if (value.action === 'createTaskPlan') {
    return isPlanFiles(value.files) && Number.isSafeInteger(value.queryTemplateVersion) && Number(value.queryTemplateVersion) >= 0 &&
      isExpectedScope(value.expectedScope) && Object.keys(value).length === 4 && JSON.stringify(value).length <= 200_000
  }
  if (value.action === 'runAcceptance') return isAcceptanceAction(value)
  if (value.action === 'forward') return Object.keys(value).length === 2 && isWorkspaceForwardRequest(value.message)
  return false
}

function isWorkspaceResult(value: unknown): value is WorkspaceResultPayload {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.message !== 'string' || !isEasyConnection(value.connection)) return false
  if (!Array.isArray(value.tabs) || !value.tabs.every(isEasyTab)) return false
  if (!Array.isArray(value.customers) || !value.customers.every(isCustomerProfile)) return false
  if (!Array.isArray(value.templates) || !value.templates.every(isQueryTemplate)) return false
  if (value.rules !== null && !isRuleBundle(value.rules)) return false
  if (!Array.isArray(value.tasks) || !value.tasks.every(isTaskSummary)) return false
  if (!isForwardedMessage(value.forwarded)) return false
  if (value.createdTask != null && !isCreatedTask(value.createdTask)) return false
  if (value.contextError !== undefined && value.contextError !== 'STALE_CONTEXT') return false
  if (value.rulesSaved !== undefined && typeof value.rulesSaved !== 'boolean') return false
  if (value.tasksRevalidated !== undefined && typeof value.tasksRevalidated !== 'boolean') return false
  if (value.pendingRevalidation !== undefined && typeof value.pendingRevalidation !== 'boolean') return false
  return value.appTab === null || (isRecord(value.appTab) && typeof value.appTab.tabId === 'number' && typeof value.appTab.created === 'boolean')
}

function isCreatedTask(value: unknown): boolean {
  return isRecord(value) && typeof value.taskId === 'string' && typeof value.taskFingerprint === 'string' &&
    typeof value.status === 'string' && typeof value.createdAt === 'string' &&
    typeof value.itemCount === 'number' && value.persisted === true &&
    (value.fileSource === 'FILE_SOURCE_UNVERIFIED' || value.fileSource === 'SEARCH_RESPONSE_OBSERVED')
}

function isEasyTab(value: unknown): value is EasyTabCandidate {
  return isRecord(value) && typeof value.id === 'number' && typeof value.title === 'string' && typeof value.url === 'string' && typeof value.origin === 'string' && isEasyOrigin(value.origin)
}

function isRuleBundle(value: unknown): value is MailRuleBundle {
  if (!isRecord(value) || value.version !== 1 || typeof value.revision !== 'number' || typeof value.ownerId !== 'string') return false
  if (!Array.isArray(value.policies) || !Array.isArray(value.mappings) || !Array.isArray(value.recipients) || !Array.isArray(value.signatures)) return false
  if (!isRecord(value.subject) || typeof value.subject.template !== 'string' || value.subject.template.length > 500) return false
  if (!isRecord(value.body) || typeof value.body.template !== 'string' || value.body.template.length > 4000) return false
  return JSON.stringify(value).length <= 200_000
}

function isForwardedMessage(value: unknown): value is AppMessage | null {
  if (value === null) return true
  if (!isRecord(value) || value.type === MessageType.Workspace || value.type === MessageType.WorkspaceResult) return false
  return isMessage(value)
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

function isShortText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function isAcceptanceAction(value: Record<string, unknown>): boolean {
  if (!isShortText(value.call, 80) || value.call.length === 0) return false
  const allowed = new Set(['action', 'call', 'caseTypeId', 'mailId', 'flowType', 'expectedFields'])
  if (Object.keys(value).some(key => !allowed.has(key))) return false
  if (value.caseTypeId !== undefined && !isShortText(value.caseTypeId, 80)) return false
  if (value.mailId !== undefined && !isShortText(value.mailId, 80)) return false
  if (value.flowType !== undefined && !isShortText(value.flowType, 20)) return false
  if (value.expectedFields !== undefined && (!isRecord(value.expectedFields) || Object.keys(value.expectedFields).length > 20 || Object.values(value.expectedFields).some(item => typeof item !== 'string'))) return false
  return true
}

function isReadonlyProbe(value: unknown): boolean {
  if (!isRecord(value) || !isShortText(value.call, 80) || !isRecord(value.expected)) return false
  if (Object.values(value.expected).some(item => typeof item !== 'string') || Object.keys(value.expected).length > 20) return false
  const allowed = new Set(['call', 'expected', 'caseTypeId', 'mailId', 'flowType'])
  if (Object.keys(value).some(key => !allowed.has(key))) return false
  if (value.caseTypeId !== undefined && !isShortText(value.caseTypeId, 80)) return false
  if (value.mailId !== undefined && !isShortText(value.mailId, 80)) return false
  if (value.flowType !== undefined && !isShortText(value.flowType, 20)) return false
  return true
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

const DICTIONARY_KINDS = new Set(['basic', 'flow', 'fieldColumn', 'listColumn', 'fileType', 'mailType', 'reviewer', 'picker', 'mailSet', 'signature'])

function isDictionaryRequest(value: unknown): value is DictionaryLoadRequest {
  if (!isRecord(value) || (value.force !== true && value.force !== false) || typeof value.kind !== 'string' || !DICTIONARY_KINDS.has(value.kind)) {
    return false
  }
  if (value.kind === 'picker') {
    const allowed = new Set(['kind', 'force', 'caseTypeId', 'country', 'procType'])
    if (!Object.keys(value).every(key => allowed.has(key))) return false
    if (value.caseTypeId !== undefined && !isFlowId(value.caseTypeId)) return false
    if (value.procType !== undefined && value.procType !== '' && !isFlowId(value.procType)) return false
    if (value.country !== undefined && (typeof value.country !== 'string' || value.country.length > 400 || !/^[A-Za-z0-9_,-]*$/.test(value.country))) return false
    return true
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

