import type { ExecutionLease } from './types'

export interface LedgerState {
  leases: ExecutionLease[]
}

export interface TransactionStore {
  /** 回调必须同步完成，不能在里面等待网络。 */
  run<T>(work: (state: LedgerState) => T): Promise<T>
}

export function memoryTransactionStore(): TransactionStore {
  let state: LedgerState = { leases: [] }
  let chain: Promise<void> = Promise.resolve()
  return {
    run(work) {
      const job = chain.then(() => {
        const draft: LedgerState = { leases: state.leases.map(item => ({ ...item })) }
        const result = work(draft)
        state = draft
        return result
      })
      chain = job.then(() => undefined, () => undefined)
      return job
    }
  }
}

function retain(leases: ExecutionLease[]): ExecutionLease[] {
  const active = leases.filter(item => item.status !== 'RELEASED' || item.requestSent)
  const released = leases.filter(item => item.status === 'RELEASED' && !item.requestSent)
  return [...active, ...released]
}

/** 在同一个存储事务里领取执行权。本地互斥不等于 EASY 服务端只执行一次。 */
export class ExecutionLedger {
  constructor(private readonly store: TransactionStore, private readonly ownerId: string) {}

  claim(origin: string, operatorId: string, taskFingerprint: string): Promise<{ ok: true; lease: ExecutionLease } | { ok: false; lease: ExecutionLease | null; reason: string }> {
    return this.store.run(state => {
      const blocking = state.leases.find(item => item.origin === origin && item.operatorId === operatorId && item.taskFingerprint === taskFingerprint && item.status !== 'RELEASED')
      if (blocking) return { ok: false as const, lease: blocking, reason: blocking.requestSent ? '请求已经发出，不能再次执行。' : '已有活动执行所有者。' }
      const now = new Date().toISOString()
      const lease: ExecutionLease = {
        executionId: globalThis.crypto.randomUUID(), taskFingerprint, owner: this.ownerId, status: 'RUNNING',
        requestSent: false, easyMailId: '', startedAt: now, updatedAt: now, lastCheckpoint: 'claimed', leaseVersion: 1, origin, operatorId
      }
      state.leases = retain([...state.leases, lease])
      return { ok: true as const, lease }
    })
  }

  markSent(executionId: string, leaseVersion: number, checkpoint: string): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.store.run(state => {
      const lease = state.leases.find(item => item.executionId === executionId)
      if (!lease || lease.owner !== this.ownerId || lease.leaseVersion !== leaseVersion) {
        return { ok: false, lease: lease ?? null, reason: '执行所有权已经变化，不能发出请求。' }
      }
      lease.requestSent = true
      lease.leaseVersion += 1
      lease.lastCheckpoint = checkpoint
      lease.updatedAt = new Date().toISOString()
      return { ok: true, lease, reason: '' }
    })
  }

  recover(origin: string, operatorId: string): Promise<ExecutionLease[]> {
    return this.store.run(state => {
      state.leases = state.leases.map(item => item.origin === origin && item.operatorId === operatorId && item.requestSent && item.status === 'RUNNING'
        ? { ...item, status: 'UNKNOWN' as const, lastCheckpoint: 'recovered', leaseVersion: item.leaseVersion + 1, updatedAt: new Date().toISOString() }
        : item)
      return state.leases.filter(item => item.origin === origin && item.operatorId === operatorId)
    })
  }
}

export function indexedTransactionStore(): TransactionStore | null {
  const factory = globalThis.indexedDB
  if (!factory) return null
  let database: IDBDatabase | null = null
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('patmail-execution-ledger', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return {
    async run(work) {
      database ??= await open
      return await new Promise((resolve, reject) => {
        const tx = database!.transaction('state', 'readwrite')
        const store = tx.objectStore('state')
        const current = store.get('leases')
        current.onsuccess = () => {
          const draft: LedgerState = { leases: Array.isArray(current.result) ? current.result.map((item: ExecutionLease) => ({ ...item })) : [] }
          try {
            const result = work(draft)
            store.put(draft.leases, 'leases')
            tx.oncomplete = () => resolve(result)
          } catch (error) {
            tx.abort()
            reject(error)
          }
        }
        current.onerror = () => reject(current.error)
        tx.onerror = () => reject(tx.error)
      })
    }
  }
}
