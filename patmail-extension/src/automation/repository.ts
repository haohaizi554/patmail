import type { AutomationTask, AutomationTaskState, Checkpoint } from './types'

export interface TaskArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROTECTED: AutomationTaskState[] = ['RUNNING', 'UNKNOWN', 'PARTIAL_FAILURE']

function keyFor(origin: string, operatorId: string): string {
  return `patmail.automation.task.v2:${origin}:${operatorId}`
}

function isCheckpoint(value: unknown): value is Checkpoint {
  if (!value || typeof value !== 'object') return false
  const item = value as Checkpoint
  return typeof item.stage === 'string' && typeof item.requestSent === 'boolean'
}

export function isProtectedTask(task: AutomationTask): boolean {
  return PROTECTED.includes(task.status) || task.checkpoints.some(item => item.requestSent && !item.verified) ||
    task.items.some(item => item.status === 'UNKNOWN' || item.status === 'RUNNING' || item.status === 'PARTIAL_FAILURE' || item.status === 'BINDING_BLOCKED')
}

export function migrateTask(task: AutomationTask): { task: AutomationTask; migration: { from: string; to: string; at: string } | null } {
  const sent = task.status === 'UNKNOWN' || task.checkpoints.some(item => item.requestSent && item.verified !== true) || task.items.some(item => item.status === 'UNKNOWN')
  const normalized: AutomationTask = {
    ...task,
    customers: task.customers ?? [],
    legacyTaskId: task.legacyTaskId ?? '',
    archived: task.archived === true,
    readonly: task.readonly === true || sent,
    verifiedAt: task.verifiedAt ?? '',
    checkpoints: task.checkpoints.map(item => ({
      stage: item.stage, itemId: item.itemId ?? '', requestSent: item.requestSent,
      responseReceived: item.responseReceived === true, verified: item.verified === true,
      easyMailId: item.easyMailId ?? '', at: item.at ?? '', note: item.note ?? ''
    })),
    status: sent ? 'UNKNOWN' : task.status
  }
  if (UUID.test(task.taskId)) return { task: normalized, migration: null }
  if (!task.taskId || !Array.isArray(task.items)) {
    return { task: { ...normalized, readonly: true, status: sent ? 'UNKNOWN' : 'BLOCKED' }, migration: null }
  }
  const nextId = globalThis.crypto.randomUUID()
  const at = new Date().toISOString()
  return {
    task: {
      ...normalized,
      taskId: nextId,
      legacyTaskId: task.taskId,
      readonly: sent || normalized.readonly,
      items: task.items.map(item => ({ ...item, taskId: nextId, easyMailId: item.easyMailId ?? '' }))
    },
    migration: { from: task.taskId, to: nextId, at }
  }
}

function isTask(value: unknown): value is AutomationTask {
  if (!value || typeof value !== 'object') return false
  const item = value as AutomationTask
  return typeof item.taskId === 'string' && typeof item.operatorId === 'string' && typeof item.origin === 'string' &&
    typeof item.taskFingerprint === 'string' && Array.isArray(item.items) && Array.isArray(item.checkpoints) &&
    item.checkpoints.every(isCheckpoint)
}

export interface StoredTasks {
  tasks: AutomationTask[]
  opaque: unknown[]
  migrations: { from: string; to: string; at: string }[]
  changed: boolean
}

export function readStoredTasks(value: unknown, origin: string, operatorId: string): StoredTasks {
  if (!value || typeof value !== 'object') return { tasks: [], opaque: [], migrations: [], changed: false }
  const record = value as { version?: unknown; tasks?: unknown; migrations?: unknown; cookie?: unknown; authorization?: unknown; password?: unknown }
  if ((record.version !== 1 && record.version !== 2) || !Array.isArray(record.tasks)) return { tasks: [], opaque: [value], migrations: [], changed: false }
  if ('cookie' in record || 'authorization' in record || 'password' in record) return { tasks: [], opaque: [], migrations: [], changed: false }
  const tasks: AutomationTask[] = []
  const opaque: unknown[] = []
  const migrations = Array.isArray(record.migrations) ? record.migrations.filter(item => item && typeof item === 'object') as StoredTasks['migrations'] : []
  let changed = false
  for (const item of record.tasks) {
    if (!isTask(item) || item.origin !== origin || item.operatorId !== operatorId) {
      opaque.push(item)
      continue
    }
    const migrated = migrateTask(item)
    tasks.push(migrated.task)
    if (migrated.migration) {
      changed = true
      migrations.push(migrated.migration)
    }
  }
  return { tasks, opaque, migrations, changed }
}

export function commitTasks(existing: AutomationTask[], incoming: AutomationTask): AutomationTask[] {
  const migrated = existing.map(item => migrateTask(item).task).filter(item => item.taskId !== incoming.taskId &&
    (incoming.legacyTaskId === '' || item.taskId !== incoming.legacyTaskId && item.legacyTaskId !== incoming.legacyTaskId))
  return migrated.concat(migrateTask(incoming).task)
}

export class TaskRepository {
  constructor(private readonly area: TaskArea | null) {}

  async list(origin: string, operatorId: string, includeArchived = false): Promise<AutomationTask[]> {
    const stored = await this.read(origin, operatorId)
    if (stored.changed && this.area) {
      await this.area.set({ [keyFor(origin, operatorId)]: { version: 2, tasks: [...stored.opaque, ...stored.tasks], migrations: stored.migrations } })
    }
    return stored.tasks.filter(item => includeArchived || !item.archived)
  }

  async save(task: AutomationTask): Promise<void> {
    if (!this.area) return
    const key = keyFor(task.origin, task.operatorId)
    const stored = await this.read(task.origin, task.operatorId)
    const tasks = commitTasks(stored.tasks, task)
    await this.area.set({ [key]: { version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations } })
  }

  async archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }> {
    const stored = await this.read(origin, operatorId)
    const task = stored.tasks.find(item => item.taskId === taskId)
    if (!task) return { ok: false, message: '没有这个任务。' }
    if (isProtectedTask(task)) return { ok: false, message: '结果未知或尚未结束的任务不能归档。' }
    await this.save({ ...task, archived: true })
    return { ok: true, message: '' }
  }

  private async read(origin: string, operatorId: string): Promise<StoredTasks> {
    if (!this.area) return { tasks: [], opaque: [], migrations: [], changed: false }
    const key = keyFor(origin, operatorId)
    const legacy = `patmail.automation.task.v1:${origin}:${operatorId}`
    const stored = await this.area.get(key)
    const current = readStoredTasks(stored[key], origin, operatorId)
    if (current.tasks.length > 0 || current.opaque.length > 0) return current
    const old = await this.area.get(legacy)
    return readStoredTasks(old[legacy], origin, operatorId)
  }
}

export class MemoryTaskRepository extends TaskRepository {
  readonly tasks: AutomationTask[] = []
  readonly opaque: unknown[] = []
  constructor() { super(null) }
  override async list(origin: string, operatorId: string, includeArchived = false): Promise<AutomationTask[]> {
    return this.tasks.filter(item => item.origin === origin && item.operatorId === operatorId && (includeArchived || !item.archived))
  }
  override async save(task: AutomationTask): Promise<void> {
    const next = commitTasks(this.tasks.filter(item => item.origin === task.origin && item.operatorId === task.operatorId), task)
    const others = this.tasks.filter(item => item.origin !== task.origin || item.operatorId !== task.operatorId)
    this.tasks.splice(0, this.tasks.length, ...others, ...next)
  }
  override async archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }> {
    const task = this.tasks.find(item => item.origin === origin && item.operatorId === operatorId && item.taskId === taskId)
    if (!task) return { ok: false, message: '没有这个任务。' }
    if (isProtectedTask(task)) return { ok: false, message: '结果未知或尚未结束的任务不能归档。' }
    task.archived = true
    return { ok: true, message: '' }
  }
}
