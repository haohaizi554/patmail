import { commitTasks, isProtectedTask, readStoredTasks } from './repository'
import type { TaskStore } from './task-service'
import type { AutomationTask } from './types'

const DB_NAME = 'patmail-automation-tasks'
const STORE = 'bundles'

function request<T>(done: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    done.onsuccess = () => resolve(done.result)
    done.onerror = () => reject(done.error)
  })
}

/** 页面 IndexedDB。保存、冲突判断和写入在同一次 readwrite 事务里完成，事务内不发网络请求。 */
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
    const raw = await request(database.transaction(STORE, 'readonly').objectStore(STORE).get(key))
    const stored = readStoredTasks(raw, origin, operatorId)
    if (stored.changed) await this.replace(key, stored.opaque, stored.tasks, stored.migrations)
    return stored.tasks.filter(item => includeArchived || !item.archived)
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
        const tasks = commitTasks(stored.tasks, task)
        store.put({ version: 2, tasks: [...stored.opaque, ...tasks], migrations: stored.migrations }, key)
      }
      tx.oncomplete = () => resolve()
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

  private async replace(key: string, opaque: unknown[], tasks: AutomationTask[], migrations: { from: string; to: string; at: string }[]): Promise<void> {
    const database = await this.open()
    await request(database.transaction(STORE, 'readwrite').objectStore(STORE).put({ version: 2, tasks: [...opaque, ...tasks], migrations }, key))
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
    archive: async () => ({ ok: false, message: '当前环境没有任务存储。' })
  }
}
