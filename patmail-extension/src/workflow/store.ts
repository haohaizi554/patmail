import { isQueryGuid } from '../query/query-validator'
import type { WorkflowExecutionRecord, WorkflowExecutionState } from './types'

const STATES = new Set<WorkflowExecutionState>([
  'NOT_STARTED', 'READING', 'READY', 'SELECTING_NODE', 'SELECTING_REVIEWER', 'PREVIEW_READY',
  'CONFIRM_REQUIRED', 'CHECKING_VERSION', 'SUBMITTING', 'SUBMITTED', 'VERIFYING',
  'COMPLETED', 'STALE', 'UNKNOWN', 'FAILED', 'BLOCKED'
])

export function workflowStorageKey(origin: string, userId: string): string | null {
  if (!isQueryGuid(userId)) return null
  return `patmail.workflow.exec.v1:${origin}:${userId}`
}

export interface WorkflowArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

function isStored(value: unknown): value is WorkflowExecutionRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as WorkflowExecutionRecord
  return typeof item.executionId === 'string' && typeof item.mailId === 'string' && typeof item.flowId === 'string' &&
    typeof item.currentNodeId === 'string' && typeof item.nextNodeId === 'string' && typeof item.reviewerId === 'string' &&
    STATES.has(item.status) && typeof item.versionToken === 'string' && typeof item.submittedAt === 'string' &&
    typeof item.lastVerifiedAt === 'string' && typeof item.lastError === 'string' && typeof item.requestSent === 'boolean' &&
    typeof item.userId === 'string' && typeof item.origin === 'string'
}

export function readWorkflowRecords(value: unknown, userId: string, origin: string): WorkflowExecutionRecord[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { version?: unknown; records?: unknown; cookie?: unknown; authorization?: unknown; password?: unknown }
  if (record.version !== 1 || !Array.isArray(record.records)) return []
  if ('cookie' in record || 'authorization' in record || 'password' in record) return []
  return record.records.filter(isStored).filter(item => item.userId === userId && item.origin === origin).slice(-40)
}

export class WorkflowStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly area: WorkflowArea | null) {}

  async exclusive<T>(origin: string, userId: string, mailId: string, run: () => Promise<T>): Promise<T> {
    const key = `${origin}\u0000${userId}\u0000${mailId}`
    const previous = this.chains.get(key) ?? Promise.resolve()
    const current = previous.then(run, run)
    this.chains.set(key, current.then(() => undefined, () => undefined))
    return current
  }

  async load(origin: string, userId: string): Promise<WorkflowExecutionRecord[]> {
    const key = this.area ? workflowStorageKey(origin, userId) : null
    if (!key || !this.area) return []
    const stored = await this.area.get(key)
    return readWorkflowRecords(stored[key], userId, origin)
  }

  async save(origin: string, userId: string, records: WorkflowExecutionRecord[]): Promise<void> {
    const key = this.area ? workflowStorageKey(origin, userId) : null
    if (!key || !this.area) return
    await this.area.set({ [key]: { version: 1, records: records.filter(item => item.userId === userId && item.origin === origin).slice(-40) } })
  }
}

export class MemoryWorkflowStore extends WorkflowStore {
  readonly records: WorkflowExecutionRecord[] = []
  constructor() { super(null) }

  override async load(origin: string, userId: string): Promise<WorkflowExecutionRecord[]> {
    return this.records.filter(item => item.origin === origin && item.userId === userId)
  }

  override async save(origin: string, userId: string, records: WorkflowExecutionRecord[]): Promise<void> {
    const others = this.records.filter(item => item.origin !== origin || item.userId !== userId)
    this.records.splice(0, this.records.length, ...others, ...records.filter(item => item.origin === origin && item.userId === userId))
  }
}
