import type { MailDraftPreview } from '../types'

export type MailExecutionState =
  | 'PREVIEW_READY' | 'CONFIRM_REQUIRED' | 'CREATING' | 'CREATED' | 'LOADING_MAIL' | 'MAIL_LOADED'
  | 'SAVE_CONFIRM_REQUIRED' | 'SAVING' | 'SAVED' | 'BINDING_FILES' | 'VERIFYING'
  | 'COMPLETED' | 'PARTIAL_FAILURE' | 'BINDING_BLOCKED' | 'UNKNOWN' | 'FAILED'

export type MailExecutionEvent =
  | 'REQUEST_CONFIRM' | 'CONFIRM_CREATE' | 'CREATE_SUCCEEDED' | 'CREATE_FAILED' | 'CREATE_UNKNOWN'
  | 'LOAD_STARTED' | 'MAIL_LOADED' | 'LOAD_FAILED'
  | 'REQUEST_SAVE' | 'CONFIRM_SAVE' | 'SAVE_SUCCEEDED' | 'SAVE_FAILED' | 'SAVE_UNKNOWN'
  | 'BIND_STARTED' | 'BIND_SUCCEEDED' | 'BIND_FAILED' | 'BIND_BLOCKED' | 'REVIEW_DIFFS'
  | 'VERIFIED' | 'VERIFY_MISMATCH'

export interface KnownValue {
  state: 'known' | 'unknown'
  value: string | null
}

export interface EasyMailIdentity {
  mailId: string
}

export interface EasyMailRecipient {
  name: string
  email: string
}

export interface EasyMailAttachment {
  fileId: string
  fileName: string
}

export interface EasyMailCase {
  caseId: string
  caseVolume: string
}

export interface EasyMailSnapshot {
  mailId: string
  customerId: KnownValue
  customerName: KnownValue
  mailTypeId: KnownValue
  mailTypeName: KnownValue
  mailsetId: KnownValue
  subject: KnownValue
  body: KnownValue
  to: KnownValue
  cc: KnownValue
  bcc: KnownValue
  subjectDesc: KnownValue
  mailTags: KnownValue
  isZip: KnownValue
  zipPwd: KnownValue
  renameZip: KnownValue
  replyDate: KnownValue
  procIds: KnownValue
  expressId: KnownValue
  messageId: KnownValue
  finishCtrlProc: KnownValue
  files: EasyMailAttachment[]
  fileListState: 'known' | 'unknown'
  cases: EasyMailCase[]
  caseListState: 'known' | 'unknown'
  contacts: EasyMailRecipient[]
  signature: KnownValue
  ruleSubject: KnownValue
}

export interface FieldDiff {
  field: string
  label: string
  easyValue: string
  planValue: string
  saveValue: string
  source: 'easy' | 'patmail' | 'unknown'
  blocksSave: boolean
}

export interface EasyMailDraft {
  mailId: string
  fields: Record<string, string>
  diffs: FieldDiff[]
  canSave: boolean
  blockers: string[]
}

export interface EasyMailSaveResult {
  mailId: string
  saved: boolean
  filesMatched: boolean
}

export interface MailExecutionView {
  record: MailExecutionRecord
  diffs: FieldDiff[]
  linkedFileIds: string[]
  blockers: string[]
}

export interface MailExecutionRecord {
  executionId: string
  userId: string
  origin: string
  customerProfileId: string
  fileIds: string[]
  mailTypeId: string
  ruleRevision: number
  fingerprint: string
  state: MailExecutionState
  mailId: string
  stage: string
  lastError: string
  requestSent: boolean
  /** 用户确认保存时必须带回的差异摘要。空字符串表示还没有可展示的差异。 */
  diffDigest: string
  updatedAt: string
}

export type WriteStatus<T> =
  | { status: 'ok'; data: T }
  | { status: 'failed'; requestSent: boolean; message: string }
  | { status: 'unknown'; requestSent: true; message: string }

export interface CreateMailInput {
  preview: MailDraftPreview
  fingerprint: string
  userId: string
  origin: string
}
