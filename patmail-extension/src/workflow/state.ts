import type { WorkflowExecutionEvent, WorkflowExecutionRecord, WorkflowExecutionState } from './types'

const NEXT: Record<WorkflowExecutionState, Partial<Record<WorkflowExecutionEvent, WorkflowExecutionState>>> = {
  NOT_STARTED: { READ_STARTED: 'READING' },
  READING: { READ_READY: 'READY', READ_FAILED: 'FAILED' },
  READY: { NEED_NODE: 'SELECTING_NODE', NEED_REVIEWER: 'SELECTING_REVIEWER', PLAN_READY: 'PREVIEW_READY', READ_FAILED: 'BLOCKED' },
  SELECTING_NODE: { NEED_REVIEWER: 'SELECTING_REVIEWER', PLAN_READY: 'PREVIEW_READY', READ_FAILED: 'BLOCKED' },
  SELECTING_REVIEWER: { PLAN_READY: 'PREVIEW_READY', READ_FAILED: 'BLOCKED' },
  PREVIEW_READY: { REQUEST_CONFIRM: 'CONFIRM_REQUIRED' },
  CONFIRM_REQUIRED: { CONFIRM_SUBMIT: 'CHECKING_VERSION', READ_FAILED: 'BLOCKED' },
  CHECKING_VERSION: { VERSION_MATCH: 'SUBMITTING', VERSION_STALE: 'STALE', VERSION_UNKNOWN: 'BLOCKED' },
  SUBMITTING: { SUBMIT_ACCEPTED: 'SUBMITTED', SUBMIT_FAILED: 'FAILED', SUBMIT_UNKNOWN: 'UNKNOWN' },
  SUBMITTED: { READ_STARTED: 'VERIFYING' },
  VERIFYING: { VERIFY_OK: 'COMPLETED', VERIFY_FAILED: 'FAILED' },
  COMPLETED: {},
  STALE: {},
  UNKNOWN: {},
  FAILED: {},
  BLOCKED: {}
}

export function nextWorkflowState(state: WorkflowExecutionState, event: WorkflowExecutionEvent): WorkflowExecutionState | null {
  return NEXT[state][event] ?? null
}

export function applyWorkflowEvent(record: WorkflowExecutionRecord, event: WorkflowExecutionEvent, patch: Partial<WorkflowExecutionRecord> = {}): WorkflowExecutionRecord {
  const status = nextWorkflowState(record.status, event)
  if (!status) return { ...record, lastError: '当前流程阶段不能执行这个操作。' }
  return { ...record, ...patch, status, lastError: patch.lastError ?? '' }
}

export function blocksAnotherSubmit(record: WorkflowExecutionRecord): boolean {
  return record.requestSent || record.status === 'UNKNOWN' || record.status === 'SUBMITTING' || record.status === 'SUBMITTED' || record.status === 'VERIFYING' || record.status === 'COMPLETED'
}
