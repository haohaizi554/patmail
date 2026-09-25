import type { MailExecutionEvent, MailExecutionRecord, MailExecutionState } from './types'

const NEXT: Record<MailExecutionState, Partial<Record<MailExecutionEvent, MailExecutionState>>> = {
  PREVIEW_READY: { REQUEST_CONFIRM: 'CONFIRM_REQUIRED' },
  CONFIRM_REQUIRED: { CONFIRM_CREATE: 'CREATING' },
  CREATING: { CREATE_SUCCEEDED: 'CREATED', CREATE_FAILED: 'FAILED', CREATE_UNKNOWN: 'UNKNOWN' },
  CREATED: { LOAD_STARTED: 'LOADING_MAIL' },
  LOADING_MAIL: { MAIL_LOADED: 'MAIL_LOADED', LOAD_FAILED: 'FAILED' },
  MAIL_LOADED: { REQUEST_SAVE: 'SAVE_CONFIRM_REQUIRED' },
  SAVE_CONFIRM_REQUIRED: { CONFIRM_SAVE: 'SAVING' },
  SAVING: { SAVE_SUCCEEDED: 'SAVED', SAVE_FAILED: 'FAILED', SAVE_UNKNOWN: 'UNKNOWN' },
  SAVED: { BIND_STARTED: 'BINDING_FILES' },
  BINDING_FILES: { BIND_SUCCEEDED: 'VERIFYING', BIND_FAILED: 'PARTIAL_FAILURE' },
  VERIFYING: { VERIFIED: 'COMPLETED', VERIFY_MISMATCH: 'PARTIAL_FAILURE' },
  COMPLETED: {},
  PARTIAL_FAILURE: {},
  UNKNOWN: {},
  FAILED: {}
}

export function nextState(state: MailExecutionState, event: MailExecutionEvent): MailExecutionState | null {
  return NEXT[state][event] ?? null
}

const BLOCKING: MailExecutionState[] = [
  'CREATING', 'CREATED', 'LOADING_MAIL', 'MAIL_LOADED', 'SAVE_CONFIRM_REQUIRED', 'SAVING', 'SAVED',
  'BINDING_FILES', 'VERIFYING', 'COMPLETED', 'PARTIAL_FAILURE', 'UNKNOWN'
]

export function blocksAnotherCreate(record: MailExecutionRecord): boolean {
  if (record.mailId || record.state === 'UNKNOWN' || record.requestSent) return true
  return BLOCKING.includes(record.state)
}

export function applyEvent(record: MailExecutionRecord, event: MailExecutionEvent, patch: Partial<MailExecutionRecord> = {}): MailExecutionRecord {
  const state = nextState(record.state, event)
  if (!state) return { ...record, lastError: '当前阶段不能执行这个操作。', updatedAt: new Date().toISOString() }
  return { ...record, ...patch, state, stage: state, lastError: patch.lastError ?? '', updatedAt: new Date().toISOString() }
}
