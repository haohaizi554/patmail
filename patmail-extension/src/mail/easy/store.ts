import { isQueryGuid } from '../../query/query-validator'
import type { MailExecutionRecord, MailExecutionState } from './types'

const STATES = new Set<MailExecutionState>([
  'PREVIEW_READY', 'CONFIRM_REQUIRED', 'CREATING', 'CREATED', 'LOADING_MAIL', 'MAIL_LOADED',
  'SAVE_CONFIRM_REQUIRED', 'SAVING', 'SAVED', 'BINDING_FILES', 'VERIFYING',
  'COMPLETED', 'PARTIAL_FAILURE', 'UNKNOWN', 'FAILED'
])

export function executionStorageKey(origin: string, userId: string): string | null {
  if (!isQueryGuid(userId)) return null
  return `patmail.mail.exec.v1:${origin}:${userId}`
}

export interface ExecutionArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

function isRecord(value: unknown): value is MailExecutionRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as MailExecutionRecord
  return typeof item.executionId === 'string' && typeof item.userId === 'string' && typeof item.origin === 'string' &&
    typeof item.customerProfileId === 'string' && Array.isArray(item.fileIds) && item.fileIds.every(id => typeof id === 'string') &&
    typeof item.mailTypeId === 'string' && typeof item.ruleRevision === 'number' && typeof item.fingerprint === 'string' &&
    STATES.has(item.state) && typeof item.mailId === 'string' && typeof item.stage === 'string' &&
    typeof item.lastError === 'string' && typeof item.requestSent === 'boolean' && typeof item.updatedAt === 'string'
}

export function readExecutionRecords(value: unknown, userId: string, origin: string): MailExecutionRecord[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { version?: unknown; records?: unknown; cookie?: unknown; authorization?: unknown }
  if (record.version !== 1 || !Array.isArray(record.records)) return []
  if ('cookie' in record || 'authorization' in record || 'password' in record) return []
  return record.records.filter(isRecord).filter(item => item.userId === userId && item.origin === origin).slice(-40)
}

export class ExecutionStore {
  constructor(private readonly area: ExecutionArea | null) {}

  async load(origin: string, userId: string): Promise<MailExecutionRecord[]> {
    const key = this.area ? executionStorageKey(origin, userId) : null
    if (!key || !this.area) return []
    const stored = await this.area.get(key)
    return readExecutionRecords(stored[key], userId, origin)
  }

  async save(origin: string, userId: string, records: MailExecutionRecord[]): Promise<void> {
    const key = this.area ? executionStorageKey(origin, userId) : null
    if (!key || !this.area) return
    const kept = records.filter(item => item.userId === userId && item.origin === origin).slice(-40)
    await this.area.set({ [key]: { version: 1, records: kept } })
  }
}

export class MemoryExecutionStore extends ExecutionStore {
  readonly records: MailExecutionRecord[] = []
  constructor() {
    super(null)
  }

  override async load(origin: string, userId: string): Promise<MailExecutionRecord[]> {
    return this.records.filter(item => item.origin === origin && item.userId === userId)
  }

  override async save(origin: string, userId: string, records: MailExecutionRecord[]): Promise<void> {
    const others = this.records.filter(item => item.origin !== origin || item.userId !== userId)
    this.records.splice(0, this.records.length, ...others, ...records.filter(item => item.origin === origin && item.userId === userId))
  }
}
