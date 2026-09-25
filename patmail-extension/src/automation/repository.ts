import type { AutomationTask } from './types'

export interface TaskArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

function keyFor(origin: string, operatorId: string): string {
  return `patmail.automation.task.v1:${origin}:${operatorId}`
}

function isTask(value: unknown): value is AutomationTask {
  if (!value || typeof value !== 'object') return false
  const item = value as AutomationTask
  return typeof item.taskId === 'string' && typeof item.operatorId === 'string' && typeof item.origin === 'string' &&
    typeof item.taskFingerprint === 'string' && Array.isArray(item.items) && Array.isArray(item.checkpoints)
}

export class TaskRepository {
  constructor(private readonly area: TaskArea | null) {}

  async list(origin: string, operatorId: string): Promise<AutomationTask[]> {
    if (!this.area) return []
    const key = keyFor(origin, operatorId)
    const stored = await this.area.get(key)
    const value = stored[key]
    if (!value || typeof value !== 'object') return []
    const record = value as { version?: unknown; tasks?: unknown; cookie?: unknown; authorization?: unknown; password?: unknown }
    if (record.version !== 1 || !Array.isArray(record.tasks)) return []
    if ('cookie' in record || 'authorization' in record || 'password' in record) return []
    return record.tasks.filter(isTask).filter(item => item.origin === origin && item.operatorId === operatorId).slice(-40)
  }

  async save(task: AutomationTask): Promise<void> {
    if (!this.area) return
    const key = keyFor(task.origin, task.operatorId)
    const existing = await this.list(task.origin, task.operatorId)
    const tasks = existing.filter(item => item.taskId !== task.taskId).concat(task).slice(-40)
    await this.area.set({ [key]: { version: 1, tasks } })
  }
}

export class MemoryTaskRepository extends TaskRepository {
  readonly tasks: AutomationTask[] = []
  constructor() { super(null) }
  override async list(origin: string, operatorId: string): Promise<AutomationTask[]> {
    return this.tasks.filter(item => item.origin === origin && item.operatorId === operatorId)
  }
  override async save(task: AutomationTask): Promise<void> {
    const index = this.tasks.findIndex(item => item.taskId === task.taskId)
    if (index >= 0) this.tasks[index] = task
    else this.tasks.push(task)
  }
}
