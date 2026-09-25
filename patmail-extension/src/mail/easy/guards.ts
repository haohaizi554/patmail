import { isRecord } from '../../shared/guards'
import type { MailDraftPreview, SelectedPatentFile } from '../types'
import type { FieldDiff, MailExecutionRecord, MailExecutionView } from './types'

const SEND = new Set(['merge_by_customer_description', 'single_file'])
const DRAFT_STATUS = new Set(['ready', 'warning', 'blocked'])
const STATES = new Set([
  'PREVIEW_READY', 'CONFIRM_REQUIRED', 'CREATING', 'CREATED', 'LOADING_MAIL', 'MAIL_LOADED',
  'SAVE_CONFIRM_REQUIRED', 'SAVING', 'SAVED', 'BINDING_FILES', 'VERIFYING',
  'COMPLETED', 'PARTIAL_FAILURE', 'UNKNOWN', 'FAILED'
])

function strings(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(item => typeof item === 'string' && item.length <= 2000)
}

function isSelectedFile(value: unknown): value is SelectedPatentFile {
  if (!isRecord(value)) return false
  return typeof value.fileId === 'string' && typeof value.fileName === 'string' &&
    typeof value.fileDescription === 'string' && typeof value.customerName === 'string'
}

export function isMailDraftPreview(value: unknown): value is MailDraftPreview {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.customerProfileId !== 'string') return false
  if (typeof value.mailTypeId !== 'string' || typeof value.mailTypeName !== 'string') return false
  if (typeof value.subject !== 'string' || typeof value.body !== 'string' || typeof value.signature !== 'string') return false
  if (typeof value.fingerprint !== 'string' || value.fingerprint.length > 20000) return false
  if (typeof value.sendMode !== 'string' || !SEND.has(value.sendMode)) return false
  if (typeof value.status !== 'string' || !DRAFT_STATUS.has(value.status)) return false
  if (!strings(value.fileIds, 50) || !strings(value.to, 30) || !strings(value.cc, 30)) return false
  if (!Array.isArray(value.files) || value.files.length !== value.fileIds.length || !value.files.every(isSelectedFile)) return false
  if (!Array.isArray(value.issues) || value.issues.length > 40 || !value.issues.every(isIssue)) return false
  if (!isRecord(value.ruleVersions) || !Object.values(value.ruleVersions).every(item => typeof item === 'number')) return false
  return true
}

function isIssue(value: unknown): boolean {
  return isRecord(value) && typeof value.code === 'string' && (value.severity === 'warning' || value.severity === 'error') &&
    typeof value.message === 'string' && typeof value.field === 'string' && typeof value.draftId === 'string'
}

function isExecutionRecord(value: unknown): value is MailExecutionRecord {
  if (!isRecord(value) || typeof value.state !== 'string' || !STATES.has(value.state)) return false
  return typeof value.executionId === 'string' && typeof value.userId === 'string' && typeof value.origin === 'string' &&
    typeof value.customerProfileId === 'string' && strings(value.fileIds, 50) && typeof value.mailTypeId === 'string' &&
    typeof value.ruleRevision === 'number' && typeof value.fingerprint === 'string' && typeof value.mailId === 'string' &&
    typeof value.stage === 'string' && typeof value.lastError === 'string' && typeof value.requestSent === 'boolean' &&
    typeof value.updatedAt === 'string'
}

function isDiff(value: unknown): value is FieldDiff {
  return isRecord(value) && typeof value.field === 'string' && typeof value.label === 'string' &&
    typeof value.easyValue === 'string' && typeof value.planValue === 'string' && typeof value.saveValue === 'string' &&
    (value.source === 'easy' || value.source === 'patmail' || value.source === 'unknown') && typeof value.blocksSave === 'boolean'
}

export function isMailExecutionView(value: unknown): value is MailExecutionView {
  if (!isRecord(value) || !isExecutionRecord(value.record)) return false
  return Array.isArray(value.diffs) && value.diffs.every(isDiff) && strings(value.linkedFileIds, 50) && strings(value.blockers, 20)
}
