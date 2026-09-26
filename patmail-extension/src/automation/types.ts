import type { MailDraftPreview, MailGroup, MailRuleBundle, SelectedPatentFile } from '../mail/types'

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
