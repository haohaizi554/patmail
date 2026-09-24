import { isCustomerProfile } from '../customer/guards'
import type { CustomerQueryProfile } from '../customer/types'
import { isQueryTemplate } from '../query/query-validator'
import type { QueryTemplate } from '../query/query-types'

export const QUERY_BUNDLE_VERSION = 1

export interface QueryBundle {
  version: typeof QUERY_BUNDLE_VERSION
  templates: QueryTemplate[]
  customers: CustomerQueryProfile[]
}

export interface QueryBundleRepository {
  readonly queueKey: string
  load(): Promise<{ bundle: QueryBundle; warning?: string; writable: boolean }>
  save(bundle: QueryBundle): Promise<void>
}

export function emptyBundle(): QueryBundle {
  return { version: QUERY_BUNDLE_VERSION, templates: [], customers: [] }
}

export function storageKey(origin: string, userId: string | null): string {
  const scope = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ? userId : 'unscoped'
  return `patmail.query.v${QUERY_BUNDLE_VERSION}:${origin}:${scope}`
}

export function readBundle(value: unknown): { bundle: QueryBundle; warning?: string; writable: boolean } {
  if (value === undefined || value === null) return { bundle: emptyBundle(), writable: true }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { bundle: emptyBundle(), warning: '本地配置无法识别，未自动覆盖原数据。', writable: false }
  }
  const record = value as Record<string, unknown>
  if (record.version !== undefined && record.version !== QUERY_BUNDLE_VERSION) {
    return { bundle: emptyBundle(), warning: '本地配置版本不匹配，未自动覆盖原数据。', writable: false }
  }
  const templates = Array.isArray(record.templates) ? record.templates.filter(isQueryTemplate) : []
  const customers = Array.isArray(record.customers) ? record.customers.filter(isCustomerProfile) : []
  const dropped = (Array.isArray(record.templates) && templates.length !== record.templates.length) ||
    (Array.isArray(record.customers) && customers.length !== record.customers.length)
  if (dropped) {
    return {
      bundle: { version: QUERY_BUNDLE_VERSION, templates, customers },
      warning: '部分本地配置结构无效，已停止写入以免覆盖原数据。',
      writable: false
    }
  }
  return { bundle: { version: QUERY_BUNDLE_VERSION, templates, customers }, writable: true }
}

export function isPersistableBundle(bundle: QueryBundle): boolean {
  return bundle.version === QUERY_BUNDLE_VERSION &&
    bundle.templates.every(isQueryTemplate) && bundle.customers.every(isCustomerProfile)
}

const bundleQueues = new Map<string, Promise<void>>()

/** 同一配置包的修改串行执行，避免并发 load-modify-save 互相覆盖。 */
export async function updateBundle(repository: QueryBundleRepository, mutate: (bundle: QueryBundle) => void): Promise<void> {
  const previous = bundleQueues.get(repository.queueKey) ?? Promise.resolve()
  const run = previous.then(async () => {
    const loaded = await repository.load()
    if (!loaded.writable) throw new Error(loaded.warning ?? '本地配置只读，未覆盖原数据。')
    const draft = structuredClone(loaded.bundle)
    mutate(draft)
    if (!isPersistableBundle(draft)) throw new Error('本地配置未通过校验，未保存。')
    await repository.save(draft)
  })
  bundleQueues.set(repository.queueKey, run.then(() => undefined, () => undefined))
  return run
}

let memoryBundleSequence = 0

export class MemoryBundleRepository implements QueryBundleRepository {
  readonly queueKey = `memory:${memoryBundleSequence++}`
  private raw: unknown

  constructor(initial?: unknown) {
    this.raw = initial
  }

  async load(): Promise<{ bundle: QueryBundle; warning?: string; writable: boolean }> {
    const read = readBundle(this.raw)
    return { ...read, bundle: structuredClone(read.bundle) }
  }

  async save(bundle: QueryBundle): Promise<void> {
    const current = readBundle(this.raw)
    if (!current.writable) throw new Error(current.warning ?? '本地配置只读，未覆盖原数据。')
    this.raw = structuredClone(bundle)
  }
}

export class ChromeBundleRepository implements QueryBundleRepository {
  readonly queueKey: string

  constructor(private readonly key: string, private readonly area: chrome.storage.StorageArea = chrome.storage.local) {
    this.queueKey = key
  }

  async load(): Promise<{ bundle: QueryBundle; warning?: string; writable: boolean }> {
    const stored = await this.area.get(this.key)
    return readBundle(stored[this.key])
  }

  async save(bundle: QueryBundle): Promise<void> {
    const stored = await this.area.get(this.key)
    const current = readBundle(stored[this.key])
    if (!current.writable) throw new Error(current.warning ?? '本地配置只读，未覆盖原数据。')
    await this.area.set({ [this.key]: bundle })
  }
}
