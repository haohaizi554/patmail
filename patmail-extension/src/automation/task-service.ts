import { recoverTask, type RecoveryAction } from './recovery'
import type { MemoryTaskRepository, TaskRepository } from './repository'
import { buildTask, type TaskBuildInput } from './task-builder'
import { validateTask } from './task-validator'
import type { AutomationTask, StageId } from './types'

export interface TaskStore {
  list(origin: string, operatorId: string, includeArchived?: boolean): Promise<AutomationTask[]>
  save(task: AutomationTask): Promise<void>
  archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }>
}

/** 任务读写都经过这一层。保存失败时不会把任务当成已经持久化。 */
export class AutomationTaskService {
  constructor(private readonly store: TaskStore) {}

  createTask(input: TaskBuildInput): Promise<{ ok: true; task: AutomationTask; persisted: true } | { ok: false; task: AutomationTask; persisted: false; message: string }> {
    const task = validateTask(buildTask(input), input)
    return this.store.save(task).then(() => this.store.list(task.origin, task.operatorId, true).then(tasks => {
      if (!tasks.some(item => item.taskId === task.taskId)) {
        return { ok: false as const, task, persisted: false as const, message: '任务没有写入存储。' }
      }
      return { ok: true as const, task, persisted: true as const }
    })).catch(() => ({ ok: false as const, task, persisted: false as const, message: '任务保存失败，没有当成已保存。' }))
  }

  listTasks(origin: string, operatorId: string): Promise<AutomationTask[]> {
    return this.store.list(origin, operatorId)
  }

  async getTask(origin: string, operatorId: string, taskId: string): Promise<AutomationTask | null> {
    const tasks = await this.store.list(origin, operatorId, true)
    return tasks.find(item => item.taskId === taskId) ?? null
  }

  async saveTask(task: AutomationTask): Promise<{ ok: boolean; message: string }> {
    try {
      await this.store.save(task)
      return { ok: true, message: '' }
    } catch {
      return { ok: false, message: '任务保存失败。' }
    }
  }

  validateTask(task: AutomationTask, current: TaskBuildInput): AutomationTask {
    return validateTask(task, current)
  }

  archiveTask(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }> {
    return this.store.archive(origin, operatorId, taskId)
  }

  recoverTask(task: AutomationTask): { action: RecoveryAction; stage: StageId | ''; reason: string; task: AutomationTask } {
    const action = recoverTask(task)
    if (task.status === 'UNKNOWN' || task.checkpoints.some(item => item.requestSent)) {
      return { ...action, task: { ...task, status: 'UNKNOWN', readonly: true } }
    }
    return { ...action, task }
  }
}

export function serviceFor(store: TaskRepository | MemoryTaskRepository): AutomationTaskService {
  return new AutomationTaskService(store)
}
