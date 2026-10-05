import type { ApiResult } from '../types'

interface CacheEntry { epoch: number; expires: number; data: unknown }
interface Flight { epoch: number; promise: Promise<ApiResult<unknown>> }

/** 只缓存归一化后的字典。失效后的旧请求不能再写回缓存。 */
export class DictionaryCache {
  private readonly keyEpoch = new Map<string, number>()
  private readonly entries = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Flight>()

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  private epoch(key: string): number {
    return this.keyEpoch.get(key) ?? 0
  }

  private bump(key: string): void {
    this.keyEpoch.set(key, this.epoch(key) + 1)
    this.entries.delete(key)
  }

  async load<T>(key: string, force: boolean, fetcher: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    let started = this.epoch(key)
    const pending = this.inflight.get(key)
    if (pending && pending.epoch === started) return pending.promise as Promise<ApiResult<T>>
    if (!force) {
      const hit = this.entries.get(key)
      if (hit && hit.epoch === started && hit.expires > this.now()) return { ok: true, data: hit.data as T }
    } else {
      this.bump(key)
      started = this.epoch(key)
    }
    const promise = fetcher().then(result => {
      if (result.ok && this.epoch(key) === started) {
        this.entries.set(key, { epoch: started, expires: this.now() + this.ttlMs, data: result.data })
      }
      return result
    }).finally(() => {
      const current = this.inflight.get(key)
      if (current?.promise === promise) this.inflight.delete(key)
    })
    this.inflight.set(key, { epoch: started, promise: promise as Promise<ApiResult<unknown>> })
    return promise
  }

  invalidateUser(userKey: string): void {
    const prefix = `${userKey}|`
    for (const key of new Set([...this.entries.keys(), ...this.keyEpoch.keys(), ...this.inflight.keys()])) {
      if (key.startsWith(prefix)) this.bump(key)
    }
  }

  invalidateFileType(userKey: string, caseTypeId: string): void {
    this.bump(this.fileTypeKey(userKey, caseTypeId))
  }

  basicKey(userKey: string): string { return `${userKey}|basic` }
  flowKey(userKey: string): string { return `${userKey}|flow` }
  fileTypeKey(userKey: string, caseTypeId: string): string { return `${userKey}|fileType|${caseTypeId}` }
  fieldColumnKey(userKey: string): string { return `${userKey}|fieldColumn` }
  listColumnKey(userKey: string): string { return `${userKey}|listColumn` }
  mailTypeKey(userKey: string): string { return `${userKey}|mailType` }
  mailSetKey(userKey: string): string { return `${userKey}|mailSet` }
  signatureKey(userKey: string): string { return `${userKey}|signature` }
  reviewerKey(userKey: string): string { return `${userKey}|reviewer` }
  customerListKey(userKey: string): string { return `${userKey}|customerList` }
  pickerKey(userKey: string, scope = ''): string { return scope ? `${userKey}|picker|${scope}` : `${userKey}|picker` }
}
