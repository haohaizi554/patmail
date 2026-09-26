import type { MailDraftPreview, MailGroup, MailRuleBundle, SelectedPatentFile } from '../mail/types'
import type { QueryDependencySnapshot } from './query-dependency'

export type AutomationTaskState =
  | 'CREATED' | 'VALIDATING' | 'READY' | 'DRY_RUNNING' | 'DRY_RUN_COMPLETED' | 'CONFIRM_REQUIRED'
  | 'QUEUED' | 'RUNNING' | 'PAUSED' | 'WAITING_USER' | 'BLOCKED' | 'PARTIAL_FAILURE'
  | 'UNKNOWN' | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'STALE'

export type AutomationItemState =
  | 'READY' | 'DRY_RUN_COMPLETED' | 'BLOCKED' | 'RUNNING' | 'WAITING_USER'
  | 'PARTIAL_FAILURE' | 'UNKNOWN' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BINDING_BLOCKED'

export type StageId =
  | 'SESSION_CHECK' | 'FILE_QUERY' | 'FILE_SELECTION' | 'CUSTOMER_RESOLVE' | 'DESCRIPTION_MAPPING' | 'MAIL_GROUPING'
  | 'RECIPIENT_RESOLVE' | 'SUBJECT_BUILD' | 'BODY_BUILD' | 'DRAFT_VALIDATE'
  | 'MAIL_CREATE' | 'MAIL_READ' | 'MAIL_DIFF' | 'MAIL_SAVE' | 'FILE_BIND' | 'MAIL_VERIFY'
  | 'WORKFLOW_READ' | 'NODE_RESOLVE' | 'REVIEWER_RESOLVE' | 'WORKFLOW_PLAN' | 'WORKFLOW_VERSION_CHECK' | 'WORKFLOW_SUBMIT' | 'WORKFLOW_VERIFY'
  | 'REVIEW_PREVIEW' | 'REVIEW_EXECUTE' | 'FINAL_VERIFY'

export interface StageDefinition {
  id: StageId
  input: string
  output: string
  precondition: string
  readonly: boolean
  sideEffect: 'none' | 'read' | 'write'
  retry: 'allowed' | 'reread-only' | 'forbidden-when-unknown'
  needsConfirmation: boolean
  success: string
  unknown: string
}

export interface AutomationIssue {
  code: string
  message: string
  itemId: string
}

export interface Checkpoint {
  stage: StageId
  itemId: string
  requestSent: boolean
  responseReceived: boolean
  verified: boolean
  easyMailId: string
  at: string
  note: string
}

/** 文件选择当时能核对到的范围。没有单文件回读契约时 verification 保持未验证。 */
export interface VerifiedSelectionSnapshot {
  fileId: string
  querySource: 'FILE_SEARCH_PAGE'
  customerProfileId: string
  fileDescription: string
  fetchedAt: string
  easyOrigin: string
  operatorId: string
  verification: 'FILE_SOURCE_UNVERIFIED'
}

export interface TaskCustomer {
  id: string
  name: string
}

/** 冻结的客户身份。easyCustomerId 只来自已确认的 EASY GUID，不用本地 Profile 编号代替。 */
export interface CustomerIdentitySnapshot {
  profileId: string
  profileName: string
  easyCustomerId: string
  bindingSource: string
  confirmed: boolean
  baseTemplateId: string
  overrideFingerprint: string
  enabled: boolean
}

export type EvidenceLevel = 'UNKNOWN' | 'REQUEST_OBSERVED' | 'RESPONSE_OBSERVED' | 'READBACK_VERIFIED'

export interface AutomationStagePlan {
  stage: StageId
  itemId: string
  sideEffect: 'none' | 'read' | 'write'
  precondition: string
  expectedInput: string
  expectedOutput: string
  canExecute: boolean
  blockers: string[]
  requiresConfirmation: boolean
  contractStatus: EvidenceLevel
}

export interface AutomationTaskItem {
  itemId: string
  taskId: string
  customerProfileId: string
  customerIdentity: CustomerIdentitySnapshot
  fileIds: string[]
  fileNames: string[]
  fileDescriptionIdentity: string
  mailTypeId: string
  mailTypeName: string
  sendMode: string
  mailDraftPreview: MailDraftPreview | null
  easyMailId: string
  mailExecutionId: string
  workflowExecutionId: string
  status: AutomationItemState
  issues: AutomationIssue[]
}

export interface AutomationTask {
  taskId: string
  name: string
  origin: string
  operatorId: string
  customerProfileId: string
  customerName: string
  customers: TaskCustomer[]
  identitySnapshot: CustomerIdentitySnapshot[]
  legacyTaskId: string
  archived: boolean
  readonly: boolean
  ruleSnapshot: MailRuleBundle
  verifiedAt: string
  selectionFingerprint: string
  taskFingerprint: string
  selectedFiles: SelectedPatentFile[]
  mailRuleRevision: number
  queryTemplateVersion: number
  /** 实际引用的模板和客户覆盖摘要。旧任务可以没有这份快照。 */
  queryDependencies?: QueryDependencySnapshot[]
  dependencyState?: 'CURRENT' | 'LEGACY_DEPENDENCY_UNKNOWN'
  /** 每次原子更新加一。缺失时按 1 参与版本比较。 */
  recordVersion?: number
  /** 查询响应观察和按 ID 回读是两种证据，不能混用。 */
  fileSource?: 'FILE_SOURCE_UNVERIFIED' | 'SEARCH_RESPONSE_OBSERVED' | 'FILE_READBACK_VERIFIED'
  verifiedSelection?: VerifiedSelectionSnapshot[]
  mailGroups: MailGroup[]
  mailDrafts: MailDraftPreview[]
  status: AutomationTaskState
  createdAt: string
  updatedAt: string
  checkpoints: Checkpoint[]
  issues: AutomationIssue[]
  items: AutomationTaskItem[]
}

export interface AutomationLog {
  taskId: string
  executionId: string
  itemId: string
  stage: string
  event: string
  status: string
  durationMs: number
  errorCode: string
  timestamp: string
}

export interface ExecutionLease {
  executionId: string
  taskFingerprint: string
  owner: string
  status: 'CLAIMED' | 'PREPARED' | 'REQUEST_SENT' | 'RESPONSE_RECEIVED' | 'VERIFIED' | 'COMPLETED' | 'UNKNOWN' | 'RELEASED' | 'RUNNING'
  requestSent: boolean
  easyMailId: string
  startedAt: string
  updatedAt: string
  lastCheckpoint: string
  leaseVersion: number
  origin: string
  operatorId: string
}
