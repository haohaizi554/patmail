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
      const blocking = state.leases.find(item => item.origin === origin && item.operatorId === operatorId && item.taskFingerprint === taskFingerprint && item.status !== 'RELEASED' && item.status !== 'COMPLETED')
      if (blocking) return { ok: false as const, lease: blocking, reason: blocking.requestSent ? '请求已经发出，不能再次执行。' : '已有活动执行所有者。' }
      const now = new Date().toISOString()
      const lease: ExecutionLease = {
        executionId: globalThis.crypto.randomUUID(), taskFingerprint, owner: this.ownerId, status: 'CLAIMED',
        requestSent: false, easyMailId: '', startedAt: now, updatedAt: now, lastCheckpoint: 'claimed', leaseVersion: 1, origin, operatorId
      }
      state.leases = retain([...state.leases, lease])
      return { ok: true as const, lease }
    })
  }

  markPrepared(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (item.requestSent || (item.status !== 'CLAIMED' && item.status !== 'RUNNING')) return '当前租约不能标记为已准备。'
      item.status = 'PREPARED'
      item.lastCheckpoint = 'prepared'
      return ''
    })
  }

  markSent(executionId: string, leaseVersion: number, checkpoint: string): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (item.requestSent || (item.status !== 'CLAIMED' && item.status !== 'PREPARED' && item.status !== 'RUNNING')) return '当前租约不能标记为已发送。'
      item.requestSent = true
      item.status = 'REQUEST_SENT'
      item.lastCheckpoint = checkpoint
      return ''
    })
  }

  markResponse(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (!item.requestSent || item.status !== 'REQUEST_SENT') return '还没有已发送的请求。'
      item.status = 'RESPONSE_RECEIVED'
      item.lastCheckpoint = 'response'
      return ''
    })
  }

  markVerified(executionId: string, leaseVersion: number, easyMailId = ''): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (!item.requestSent || (item.status !== 'RESPONSE_RECEIVED' && item.status !== 'UNKNOWN')) return '没有可核验的响应。'
      item.status = 'VERIFIED'
      item.easyMailId = easyMailId || item.easyMailId
      item.lastCheckpoint = 'verified'
      return ''
    })
  }

  complete(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (item.status !== 'VERIFIED') return '只有核验通过的租约可以完成。'
      item.status = 'COMPLETED'
      item.lastCheckpoint = 'completed'
      return ''
    })
  }

  releaseBeforeSend(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (item.requestSent) return '请求已经发出，不能释放。'
      item.status = 'RELEASED'
      item.lastCheckpoint = 'released-before-send'
      return ''
    })
  }

  markUnknown(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.transition(executionId, leaseVersion, item => {
      if (!item.requestSent) return '请求尚未发出，应释放而不是标成未知。'
      item.status = 'UNKNOWN'
      item.lastCheckpoint = 'unknown'
      return ''
    })
  }

  recover(origin: string, operatorId: string): Promise<ExecutionLease[]> {
    return this.store.run(state => {
      const now = new Date().toISOString()
      state.leases = state.leases.map(item => {
        if (item.origin !== origin || item.operatorId !== operatorId) return item
        if (item.status === 'RELEASED' || item.status === 'COMPLETED' || item.status === 'VERIFIED') return item
        if (item.requestSent) return { ...item, status: 'UNKNOWN' as const, lastCheckpoint: 'recovered', leaseVersion: item.leaseVersion + 1, updatedAt: now }
        return { ...item, status: 'RELEASED' as const, lastCheckpoint: 'abandoned-before-send', leaseVersion: item.leaseVersion + 1, updatedAt: now }
      })
      return state.leases.filter(item => item.origin === origin && item.operatorId === operatorId)
    })
  }

  private transition(executionId: string, leaseVersion: number, apply: (lease: ExecutionLease) => string): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }> {
    return this.store.run(state => {
      const lease = state.leases.find(item => item.executionId === executionId)
      if (!lease || lease.owner !== this.ownerId || lease.leaseVersion !== leaseVersion) {
        return { ok: false, lease: lease ?? null, reason: '执行所有权已经变化，不能发出请求。' }
      }
      const reason = apply(lease)
      if (reason) return { ok: false, lease, reason }
      lease.leaseVersion += 1
      lease.updatedAt = new Date().toISOString()
      return { ok: true, lease, reason: '' }
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
