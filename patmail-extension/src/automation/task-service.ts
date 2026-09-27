import { isConfirmedOperator } from './operator'
import { recoverTask, type RecoveryAction } from './recovery'
import type { MemoryTaskRepository, TaskRepository, TaskSaveResult } from './repository'
import { buildTask, type TaskBuildInput } from './task-builder'
import { validateTask } from './task-validator'
import type { AutomationTask, StageId } from './types'

export interface TaskStore {
  list(origin: string, operatorId: string, includeArchived?: boolean): Promise<AutomationTask[]>
  save(task: AutomationTask): Promise<TaskSaveResult>
  updateTaskAtomically(
    origin: string,
    operatorId: string,
    taskId: string,
    expectedVersion: number,
    transition: (current: AutomationTask) => { ok: true; task: AutomationTask } | { ok: false; message: string }
  ): Promise<TaskSaveResult>
  archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }>
}

export type { TaskSaveResult }

/** 任务读写都经过这一层。保存失败时不会把任务当成已经持久化。 */
export class AutomationTaskService {
  constructor(private readonly store: TaskStore) {}

  createTask(input: TaskBuildInput): Promise<{ ok: true; task: AutomationTask; persisted: true } | { ok: false; task: AutomationTask; persisted: false; message: string }> {
    const task = validateTask(buildTask(input), input)
    if (!isConfirmedOperator(input.operatorId)) {
      return Promise.resolve({ ok: false, task, persisted: false, message: '当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。' })
    }
    return this.store.save(task).then(saved => {
      if (saved && saved.ok === false) return { ok: false as const, task, persisted: false as const, message: saved.message }
      return this.store.list(task.origin, task.operatorId, true).then(tasks => {
        if (!tasks.some(item => item.taskId === task.taskId)) {
          return { ok: false as const, task, persisted: false as const, message: '任务没有写入存储。' }
        }
        return { ok: true as const, task: saved && saved.ok ? saved.task : task, persisted: true as const }
      })
    }).catch(() => ({ ok: false as const, task, persisted: false as const, message: '任务保存失败，没有当成已保存。' }))
  }

  listTasks(origin: string, operatorId: string): Promise<AutomationTask[]> {
    if (!isConfirmedOperator(operatorId)) return Promise.resolve([])
    return this.store.list(origin, operatorId)
  }

  async getTask(origin: string, operatorId: string, taskId: string): Promise<AutomationTask | null> {
    const tasks = await this.store.list(origin, operatorId, true)
    return tasks.find(item => item.taskId === taskId) ?? null
  }

  async saveTask(task: AutomationTask): Promise<{ ok: boolean; message: string }> {
    if (!isConfirmedOperator(task.operatorId)) {
      return { ok: false, message: '当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。' }
    }
    try {
      const saved = await this.store.save(task)
      return saved.ok ? { ok: true, message: '' } : { ok: false, message: saved.message }
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
