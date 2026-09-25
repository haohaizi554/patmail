import type { WorkflowExecutionEvent, WorkflowExecutionRecord, WorkflowExecutionState } from './types'

const NEXT: Record<WorkflowExecutionState, Partial<Record<WorkflowExecutionEvent, WorkflowExecutionState>>> = {
  NOT_STARTED: { READ_STARTED: 'READING' },
  READING: { READ_READY: 'READY', READ_FAILED: 'FAILED' },
  READY: {
    NEED_NODE: 'SELECTING_NODE', NEED_REVIEWER: 'SELECTING_REVIEWER', PLAN_READY: 'PREVIEW_READY', PLAN_UPDATED: 'PREVIEW_READY',
    READ_FAILED: 'BLOCKED', PLAN_INVALIDATED: 'READY', REPLAN_REQUESTED: 'READY', READ_REFRESHED: 'READY'
  },
  SELECTING_NODE: {
    NEED_REVIEWER: 'SELECTING_REVIEWER', PLAN_READY: 'PREVIEW_READY', PLAN_UPDATED: 'PREVIEW_READY', READ_FAILED: 'BLOCKED',
    PLAN_INVALIDATED: 'READY', REPLAN_REQUESTED: 'READY', READ_REFRESHED: 'READY'
  },
  SELECTING_REVIEWER: {
    PLAN_READY: 'PREVIEW_READY', PLAN_UPDATED: 'PREVIEW_READY', READ_FAILED: 'BLOCKED',
    PLAN_INVALIDATED: 'READY', REPLAN_REQUESTED: 'READY', READ_REFRESHED: 'READY'
  },
  PREVIEW_READY: { REQUEST_CONFIRM: 'CONFIRM_REQUIRED', PLAN_INVALIDATED: 'READY', REPLAN_REQUESTED: 'READY', READ_REFRESHED: 'READY' },
  CONFIRM_REQUIRED: { CONFIRM_SUBMIT: 'CHECKING_VERSION', READ_FAILED: 'BLOCKED', PLAN_INVALIDATED: 'READY', REPLAN_REQUESTED: 'READY', READ_REFRESHED: 'READY' },
  CHECKING_VERSION: { VERSION_MATCH: 'SUBMITTING', VERSION_STALE: 'STALE', VERSION_UNKNOWN: 'BLOCKED', PLAN_INVALIDATED: 'READY' },
  SUBMITTING: { SUBMIT_ACCEPTED: 'SUBMITTED', SUBMIT_FAILED: 'FAILED', SUBMIT_UNKNOWN: 'UNKNOWN' },
  SUBMITTED: { READ_STARTED: 'VERIFYING' },
  VERIFYING: { VERIFY_OK: 'COMPLETED', VERIFY_FAILED: 'FAILED' },
  COMPLETED: {},
  STALE: { REPLAN_REQUESTED: 'READY', PLAN_INVALIDATED: 'READY', READ_REFRESHED: 'READY' },
  UNKNOWN: {},
  FAILED: { REPLAN_REQUESTED: 'READY', PLAN_INVALIDATED: 'READY' },
  BLOCKED: { REPLAN_REQUESTED: 'READY', PLAN_INVALIDATED: 'READY', READ_REFRESHED: 'READY' }
}

/** 已经发出写请求的状态没有重新规划出口。 */
export function canReplan(record: WorkflowExecutionRecord): boolean {
  if (record.requestSent) return false
  return nextWorkflowState(record.status, 'PLAN_INVALIDATED') !== null || nextWorkflowState(record.status, 'REPLAN_REQUESTED') !== null
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
