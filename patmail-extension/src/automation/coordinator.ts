import type { ExecutionLease } from './types'

/** 客户端锁即使串行，也不能证明两个标签页不会各写一次。生产写开关继续关闭。 */
export const CROSS_TAB_WRITE_EXCLUSION_PROVEN = false

export interface LockProvider {
  exclusive<T>(name: string, run: () => Promise<T>): Promise<T>
}

export interface LeaseArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export function processLocalLock(): LockProvider {
  const chains = new Map<string, Promise<unknown>>()
  return {
    exclusive(name, run) {
      const previous = chains.get(name) ?? Promise.resolve()
      const current = previous.then(run, run)
      chains.set(name, current.then(() => undefined, () => undefined))
      return current
    }
  }
}

export function browserLock(): LockProvider | null {
  const locks = globalThis.navigator?.locks
  if (!locks) return null
  return {
    exclusive(name, run) {
      return locks.request(`patmail:${name}`, () => run()) as ReturnType<typeof run>
    }
  }
}

function storageKey(origin: string, operatorId: string): string {
  return `patmail.exec.lease.v1:${origin}:${operatorId}`
}

function readLeases(value: unknown): ExecutionLease[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { version?: unknown; leases?: unknown; cookie?: unknown; authorization?: unknown; password?: unknown }
  if (record.version !== 1 || !Array.isArray(record.leases)) return []
  if ('cookie' in record || 'authorization' in record || 'password' in record) return []
  return record.leases.filter(isLease).map(item => ({ ...item, leaseVersion: item.leaseVersion || 1 }))
}

function retainLeases(leases: ExecutionLease[]): ExecutionLease[] {
  const kept = leases.filter(item => item.status !== 'RELEASED' || item.requestSent)
  const released = leases.filter(item => item.status === 'RELEASED' && !item.requestSent)
  return [...kept, ...released]
}

function isLease(value: unknown): value is ExecutionLease {
  if (!value || typeof value !== 'object') return false
  const item = value as ExecutionLease
  return typeof item.executionId === 'string' && typeof item.taskFingerprint === 'string' && typeof item.owner === 'string' &&
    (item.status === 'RUNNING' || item.status === 'UNKNOWN' || item.status === 'RELEASED') && typeof item.requestSent === 'boolean' &&
    typeof item.easyMailId === 'string' && typeof item.origin === 'string' && typeof item.operatorId === 'string'
}

export class ExecutionCoordinator {
  constructor(private readonly area: LeaseArea, private readonly lock: LockProvider, private readonly ownerId: string) {}

  async claim(origin: string, operatorId: string, taskFingerprint: string): Promise<{ ok: true; lease: ExecutionLease } | { ok: false; lease: ExecutionLease | null; reason: string }> {
    return this.lock.exclusive(`${origin}\u0000${operatorId}\u0000${taskFingerprint}`, async () => {
      const key = storageKey(origin, operatorId)
      const stored = await this.area.get(key)
      const leases = readLeases(stored[key])
      const blocking = leases.find(item => item.taskFingerprint === taskFingerprint && item.status !== 'RELEASED')
      if (blocking) return { ok: false as const, lease: blocking, reason: blocking.requestSent ? '请求已经发出，不能再次执行。' : '已有活动执行所有者。' }
      const now = new Date().toISOString()
      const lease: ExecutionLease = {
        executionId: globalThis.crypto.randomUUID(), taskFingerprint, owner: this.ownerId, status: 'RUNNING',
        requestSent: false, easyMailId: '', startedAt: now, updatedAt: now, lastCheckpoint: 'claimed', leaseVersion: 1, origin, operatorId
      }
      await this.area.set({ [key]: { version: 1, leases: retainLeases([...leases, lease]) } })
      return { ok: true as const, lease }
    })
  }

  async markSent(origin: string, operatorId: string, executionId: string, checkpoint: string): Promise<void> {
    await this.update(origin, operatorId, executionId, item => ({ ...item, requestSent: true, lastCheckpoint: checkpoint, updatedAt: new Date().toISOString() }))
  }

  /** Service Worker 重启后只从存储恢复。已发出的请求改成 UNKNOWN，不自动重试。 */
  async recover(origin: string, operatorId: string): Promise<ExecutionLease[]> {
    const key = storageKey(origin, operatorId)
    const stored = await this.area.get(key)
    const leases = readLeases(stored[key]).map(item => item.requestSent && item.status === 'RUNNING'
      ? { ...item, status: 'UNKNOWN' as const, lastCheckpoint: 'recovered', updatedAt: new Date().toISOString() }
      : item)
    await this.area.set({ [key]: { version: 1, leases } })
    return leases
  }

  private async update(origin: string, operatorId: string, executionId: string, map: (lease: ExecutionLease) => ExecutionLease): Promise<void> {
    const key = storageKey(origin, operatorId)
    const stored = await this.area.get(key)
    const leases = readLeases(stored[key]).map(item => item.executionId === executionId ? map(item) : item)
    await this.area.set({ [key]: { version: 1, leases } })
  }
}

export function allowsProductionWrite(): boolean {
  return CROSS_TAB_WRITE_EXCLUSION_PROVEN
}
