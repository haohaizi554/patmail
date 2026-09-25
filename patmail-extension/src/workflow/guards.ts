import { isQueryGuid } from '../query/query-validator'
import { isRecord } from '../shared/guards'
import type { WorkflowExecutionRecord, WorkflowExecutionState, WorkflowView } from './types'

const STATES = new Set<WorkflowExecutionState>([
  'NOT_STARTED', 'READING', 'READY', 'SELECTING_NODE', 'SELECTING_REVIEWER', 'PREVIEW_READY',
  'CONFIRM_REQUIRED', 'CHECKING_VERSION', 'SUBMITTING', 'SUBMITTED', 'VERIFYING',
  'COMPLETED', 'STALE', 'UNKNOWN', 'FAILED', 'BLOCKED'
])

export function isWorkflowRecord(value: unknown): value is WorkflowExecutionRecord {
  if (!isRecord(value) || typeof value.status !== 'string' || !STATES.has(value.status as WorkflowExecutionState)) return false
  return typeof value.executionId === 'string' && typeof value.mailId === 'string' && typeof value.flowId === 'string' &&
    typeof value.currentNodeId === 'string' && typeof value.nextNodeId === 'string' && typeof value.reviewerId === 'string' &&
    typeof value.versionToken === 'string' && typeof value.submittedAt === 'string' && typeof value.lastVerifiedAt === 'string' &&
    typeof value.lastError === 'string' && typeof value.requestSent === 'boolean' && typeof value.userId === 'string' &&
    typeof value.origin === 'string' && (value.mailId === '' || isQueryGuid(value.mailId))
}

export function isWorkflowView(value: unknown): value is WorkflowView {
  if (!isRecord(value) || !isWorkflowRecord(value.record)) return false
  if (!Array.isArray(value.blockers) || value.blockers.some(item => typeof item !== 'string')) return false
  return value.snapshot === null || isRecord(value.snapshot)
}
