import { applyAtomicTaskUpdate, commitTasks, isProtectedTask, readStoredTasks } from './repository'
import { preservedEvidence } from './task-transition'
import type { TaskStore } from './task-service'
import type { AutomationTask } from './types'

const DB_NAME = 'patmail-automation-tasks'
const STORE = 'bundles'

/** Background 或页面 IndexedDB。迁移、冲突判断和写入都在同一次 readwrite 事务里完成，事务内不发网络请求。 */
export class IndexedTaskStore implements TaskStore {
  private database: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.database
  }

  async list(origin: string, operatorId: string, includeArchived = false): Promise<AutomationTask[]> {
    const key = `${origin}\u0000${operatorId}`
    const database = await this.open()
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const current = store.get(key)
      let tasks: AutomationTask[] = []
      current.onsuccess = () => {
        const stored = readStoredTasks(current.result, origin, operatorId)
        tasks = stored.tasks.filter(item => includeArchived || !item.archived)
        if (stored.changed) store.put({ version: 2, tasks: [...stored.opaque, ...stored.tasks], migrations: stored.migrations }, key)
      }
      current.onerror = () => reject(current.error)
      tx.oncomplete = () => resolve(tasks)
      tx.onerror = () => reject(tx.error)
    })
  }

  async save(task: AutomationTask): Promise<void> {
    const key = `${task.origin}\u0000${task.operatorId}`
    const database = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const current = store.get(key)
      current.onsuccess = () => {
        const stored = readStoredTasks(current.result, task.origin, task.operatorId)
        const prior = stored.tasks.find(item => item.taskId === task.taskId)
        if (prior && preservedEvidence(prior, task)) return
        const tasks = commitTasks(stored.tasks, task)
        store.put({ version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations }, key)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async updateTaskAtomically(origin: string, operatorId: string, taskId: string, expectedVersion: number, transition: (current: AutomationTask) => { ok: true; task: AutomationTask } | { ok: false; message: string }): Promise<{ ok: boolean; message: string; task: AutomationTask | null }> {
    const key = `${origin}\u0000${operatorId}`
    const database = await this.open()
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const current = store.get(key)
      let outcome: { ok: boolean; message: string; task: AutomationTask | null } = { ok: false, message: '没有这个任务。', task: null }
      current.onsuccess = () => {
        const stored = readStoredTasks(current.result, origin, operatorId)
        const result = applyAtomicTaskUpdate(stored.tasks, taskId, expectedVersion, transition)
        outcome = { ok: result.ok, message: result.message, task: result.task }
        if (result.ok) store.put({ version: 2, tasks: [...stored.opaque, ...result.tasks], migrations: stored.migrations }, key)
      }
      current.onerror = () => reject(current.error)
      tx.oncomplete = () => resolve(outcome)
      tx.onerror = () => reject(tx.error)
    })
  }

  async archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }> {
    const key = `${origin}\u0000${operatorId}`
    const database = await this.open()
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const current = store.get(key)
      let outcome: { ok: boolean; message: string } = { ok: false, message: '没有这个任务。' }
      current.onsuccess = () => {
        const stored = readStoredTasks(current.result, origin, operatorId)
        const task = stored.tasks.find(item => item.taskId === taskId)
        if (!task) return
        if (isProtectedTask(task)) {
          outcome = { ok: false, message: '结果未知或尚未结束的任务不能归档。' }
          return
        }
        const tasks = commitTasks(stored.tasks, { ...task, archived: true })
        store.put({ version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations }, key)
        outcome = { ok: true, message: '' }
      }
      current.onerror = () => reject(current.error)
      tx.oncomplete = () => resolve(outcome)
      tx.onerror = () => reject(tx.error)
    })
  }

}

/** 测试用的串行存储。每次读取、迁移和写入都在同一次回调里完成。 */
export class SerialTaskStore implements TaskStore {
  private chain: Promise<void> = Promise.resolve()
  constructor(private raw: unknown) {}

  list(origin: string, operatorId: string, includeArchived = false): Promise<AutomationTask[]> {
    return this.run(() => {
      const stored = readStoredTasks(this.raw, origin, operatorId)
      if (stored.changed) this.raw = { version: 2, tasks: [...stored.opaque, ...stored.tasks], migrations: stored.migrations }
      return stored.tasks.filter(item => includeArchived || !item.archived)
    })
  }

  save(task: AutomationTask): Promise<void> {
    return this.run(() => {
      const stored = readStoredTasks(this.raw, task.origin, task.operatorId)
      const prior = stored.tasks.find(item => item.taskId === task.taskId)
      if (prior && preservedEvidence(prior, task)) return
      const tasks = commitTasks(stored.tasks, task)
      this.raw = { version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations }
    })
  }

  updateTaskAtomically(origin: string, operatorId: string, taskId: string, expectedVersion: number, transition: (current: AutomationTask) => { ok: true; task: AutomationTask } | { ok: false; message: string }): Promise<{ ok: boolean; message: string; task: AutomationTask | null }> {
    return this.run(() => {
      const stored = readStoredTasks(this.raw, origin, operatorId)
      const result = applyAtomicTaskUpdate(stored.tasks, taskId, expectedVersion, transition)
      if (result.ok) this.raw = { version: 2, tasks: [...stored.opaque, ...result.tasks], migrations: stored.migrations }
      return { ok: result.ok, message: result.message, task: result.task }
    })
  }

  archive(origin: string, operatorId: string, taskId: string): Promise<{ ok: boolean; message: string }> {
    return this.run(() => {
      const stored = readStoredTasks(this.raw, origin, operatorId)
      const task = stored.tasks.find(item => item.taskId === taskId)
      if (!task) return { ok: false, message: '没有这个任务。' }
      if (isProtectedTask(task)) return { ok: false, message: '结果未知或尚未结束的任务不能归档。' }
      const tasks = commitTasks(stored.tasks, { ...task, archived: true })
      this.raw = { version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations }
      return { ok: true, message: '' }
    })
  }

  private run<T>(work: () => T): Promise<T> {
    const job = this.chain.then(() => work())
    this.chain = job.then(() => undefined, () => undefined)
    return job
  }
}

export function createBrowserTaskStore(): TaskStore {
  const factory = globalThis.indexedDB
  if (!factory) return emptyStore()
  return new IndexedTaskStore(factory)
}

function emptyStore(): TaskStore {
  return {
    list: async () => [],
    save: async () => { throw new Error('当前环境没有任务存储。') },
    updateTaskAtomically: async () => ({ ok: false, message: '当前环境没有任务存储。', task: null }),
    archive: async () => ({ ok: false, message: '当前环境没有任务存储。' })
  }
}
