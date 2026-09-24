import type { ApiResult } from '../types'

interface CacheEntry { expires: number; data: unknown }

/** 只缓存归一化后的字典，不保存 Cookie、密码或用户模型。 */
export class DictionaryCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<ApiResult<unknown>>>()

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  async load<T>(key: string, force: boolean, fetcher: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    if (!force) {
      const hit = this.entries.get(key)
      if (hit && hit.expires > this.now()) return { ok: true, data: hit.data as T }
    }
    const pending = this.inflight.get(key)
    if (pending) return pending as Promise<ApiResult<T>>
    const promise = fetcher().then(result => {
      if (result.ok) this.entries.set(key, { expires: this.now() + this.ttlMs, data: result.data })
      return result
    }).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key)
    })
    this.inflight.set(key, promise as Promise<ApiResult<unknown>>)
    return promise
  }

  invalidateUser(userKey: string): void {
    const prefix = `${userKey}|`
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key)
  }

  invalidateFileType(userKey: string, caseTypeId: string): void {
    this.entries.delete(this.fileTypeKey(userKey, caseTypeId))
  }

  basicKey(userKey: string): string { return `${userKey}|basic` }
  flowKey(userKey: string): string { return `${userKey}|flow` }
  fileTypeKey(userKey: string, caseTypeId: string): string { return `${userKey}|fileType|${caseTypeId}` }
  fieldColumnKey(userKey: string): string { return `${userKey}|fieldColumn` }
  listColumnKey(userKey: string): string { return `${userKey}|listColumn` }
}
