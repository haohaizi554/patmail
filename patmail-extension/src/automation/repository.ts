import { emptyIdentity } from './snapshot'
import { preservedEvidence } from './task-transition'
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
    identitySnapshot: task.identitySnapshot ?? [],
    legacyTaskId: task.legacyTaskId ?? '',
    archived: task.archived === true,
    readonly: task.readonly === true || sent,
    verifiedAt: task.verifiedAt ?? '',
    checkpoints: task.checkpoints.map(item => ({
      stage: item.stage, itemId: item.itemId ?? '', requestSent: item.requestSent,
      responseReceived: item.responseReceived === true, verified: item.verified === true,
      easyMailId: item.easyMailId ?? '', at: item.at ?? '', note: item.note ?? ''
    })),
    status: sent ? 'UNKNOWN' : task.status,
    items: task.items.map(item => ({ ...item, customerIdentity: item.customerIdentity ?? emptyIdentity(), easyMailId: item.easyMailId ?? '' }))
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
      items: task.items.map(item => ({ ...item, taskId: nextId, easyMailId: item.easyMailId ?? '', customerIdentity: item.customerIdentity ?? emptyIdentity() }))
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

export type TaskSaveCode = 'VERSION_CONFLICT' | 'PROTECTED_EVIDENCE' | 'INVALID_TRANSITION'

export type TaskSaveResult =
  | { ok: true; task: AutomationTask; recordVersion: number }
  | { ok: false; code: TaskSaveCode; message: string; current?: AutomationTask }

export interface AtomicTaskResult {
  ok: boolean
  code?: TaskSaveCode
  message: string
  task: AutomationTask | null
  tasks: AutomationTask[]
}

/** 插入可以走 save。已有记录如果会抹掉执行证据，必须返回失败，不能当成保存成功。 */
export function decideTaskSave(prior: AutomationTask | undefined, task: AutomationTask): { write: AutomationTask | null; result: TaskSaveResult } {
  if (!prior) {
    const next = { ...task, recordVersion: task.recordVersion ?? 1 }
    return { write: next, result: { ok: true, task: next, recordVersion: next.recordVersion ?? 1 } }
  }
  const blocked = preservedEvidence(prior, task)
  if (blocked) return { write: null, result: { ok: false, code: 'PROTECTED_EVIDENCE', message: blocked, current: prior } }
  const next: AutomationTask = {
    ...task,
    taskId: prior.taskId,
    origin: prior.origin,
    operatorId: prior.operatorId,
    recordVersion: (prior.recordVersion ?? 1) + 1
  }
  return { write: next, result: { ok: true, task: next, recordVersion: next.recordVersion ?? 1 } }
}

/** 版本检查、执行证据和写入决定在同一次计算里完成，调用方把它放进同一个存储事务。 */
export function applyAtomicTaskUpdate(
  existing: AutomationTask[],
  taskId: string,
  expectedVersion: number,
  transition: (current: AutomationTask) => { ok: true; task: AutomationTask } | { ok: false; message: string }
): AtomicTaskResult {
  const current = existing.find(item => item.taskId === taskId)
  if (!current) return { ok: false, code: 'INVALID_TRANSITION', message: '没有这个任务。', task: null, tasks: existing }
  const version = current.recordVersion ?? 1
  if (version !== expectedVersion) return { ok: false, code: 'VERSION_CONFLICT', message: '任务版本已变化。', task: current, tasks: existing }
  const proposed = transition(current)
  if (!proposed.ok) return { ok: false, code: 'INVALID_TRANSITION', message: proposed.message, task: current, tasks: existing }
  const blocked = preservedEvidence(current, proposed.task)
  if (blocked) return { ok: false, code: 'PROTECTED_EVIDENCE', message: blocked, task: current, tasks: existing }
  const next: AutomationTask = {
    ...proposed.task,
    taskId: current.taskId,
    origin: current.origin,
    operatorId: current.operatorId,
    recordVersion: version + 1
  }
  return { ok: true, message: '', task: next, tasks: commitTasks(existing, next) }
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

  async save(task: AutomationTask): Promise<TaskSaveResult> {
    if (!this.area) return { ok: false, code: 'INVALID_TRANSITION', message: '当前环境没有任务存储。' }
    return enqueueTaskStore(task.origin, task.operatorId, async () => {
      const key = keyFor(task.origin, task.operatorId)
      const stored = await this.read(task.origin, task.operatorId)
      const prior = stored.tasks.find(item => item.taskId === task.taskId)
      const decided = decideTaskSave(prior, task)
      if (decided.write) {
        const tasks = commitTasks(stored.tasks, decided.write)
        await this.area?.set({ [key]: { version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations } })
      }
      return decided.result
    })
  }

  async updateTaskAtomically(origin: string, operatorId: string, taskId: string, expectedVersion: number, transition: (current: AutomationTask) => { ok: true; task: AutomationTask } | { ok: false; message: string }): Promise<TaskSaveResult> {
    return enqueueTaskStore(origin, operatorId, async () => {
      const stored = await this.read(origin, operatorId)
      const result = applyAtomicTaskUpdate(stored.tasks, taskId, expectedVersion, transition)
      if (result.ok && result.task && this.area) {
        await this.area.set({ [keyFor(origin, operatorId)]: { version: 2, tasks: [...stored.opaque, ...result.tasks], migrations: stored.migrations } })
        return { ok: true as const, task: result.task, recordVersion: result.task.recordVersion ?? 1 }
      }
      return { ok: false as const, code: result.code ?? 'INVALID_TRANSITION', message: result.message, current: result.task ?? undefined }
    })
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
  override async save(task: AutomationTask): Promise<TaskSaveResult> {
    const scoped = this.tasks.filter(item => item.origin === task.origin && item.operatorId === task.operatorId)
    const prior = scoped.find(item => item.taskId === task.taskId)
    const decided = decideTaskSave(prior, task)
    if (decided.write) {
      const next = commitTasks(scoped, decided.write)
      const others = this.tasks.filter(item => item.origin !== task.origin || item.operatorId !== task.operatorId)
      this.tasks.splice(0, this.tasks.length, ...others, ...next)
    }
    return decided.result
  }
  override async updateTaskAtomically(origin: string, operatorId: string, taskId: string, expectedVersion: number, transition: (current: AutomationTask) => { ok: true; task: AutomationTask } | { ok: false; message: string }): Promise<TaskSaveResult> {
    const scoped = this.tasks.filter(item => item.origin === origin && item.operatorId === operatorId)
    const result = applyAtomicTaskUpdate(scoped, taskId, expectedVersion, transition)
    if (result.ok && result.task) {
      const others = this.tasks.filter(item => item.origin !== origin || item.operatorId !== operatorId)
      this.tasks.splice(0, this.tasks.length, ...others, ...result.tasks)
      return { ok: true, task: result.task, recordVersion: result.task.recordVersion ?? 1 }
    }
    return { ok: false, code: result.code ?? 'INVALID_TRANSITION', message: result.message, current: result.task ?? undefined }
  }
  override async archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }> {
    const task = this.tasks.find(item => item.origin === origin && item.operatorId === operatorId && item.taskId === taskId)
    if (!task) return { ok: false, message: '没有这个任务。' }
    if (isProtectedTask(task)) return { ok: false, message: '结果未知或尚未结束的任务不能归档。' }
    task.archived = true
    return { ok: true, message: '' }
  }
}

const taskQueues = new Map<string, Promise<unknown>>()

/** 同一进程内串行化 chrome.storage 任务写入。这不是跨进程事务。 */
function enqueueTaskStore<T>(origin: string, operatorId: string, work: () => Promise<T>): Promise<T> {
  const key = keyFor(origin, operatorId)
  const previous = taskQueues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  taskQueues.set(key, run.then(() => undefined, () => undefined))
  return run
}
