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
  load(): Promise<{ bundle: QueryBundle; warning?: string }>
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

export function readBundle(value: unknown): { bundle: QueryBundle; warning?: string } {
  if (value === undefined || value === null) return { bundle: emptyBundle() }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { bundle: emptyBundle(), warning: '本地配置无法识别，未自动覆盖原数据。' }
  }
  const record = value as Record<string, unknown>
  if (record.version !== undefined && record.version !== QUERY_BUNDLE_VERSION) {
    return { bundle: emptyBundle(), warning: '本地配置版本不匹配，未自动覆盖原数据。' }
  }
  const templates = Array.isArray(record.templates) ? record.templates.filter(isQueryTemplate) : []
  const customers = Array.isArray(record.customers) ? record.customers.filter(isCustomerProfile) : []
  const dropped = (Array.isArray(record.templates) && templates.length !== record.templates.length) ||
    (Array.isArray(record.customers) && customers.length !== record.customers.length)
  return {
    bundle: { version: QUERY_BUNDLE_VERSION, templates, customers },
    ...(dropped ? { warning: '部分本地配置结构无效，已跳过。' } : {})
  }
}

export class MemoryBundleRepository implements QueryBundleRepository {
  bundle = emptyBundle()

  async load(): Promise<{ bundle: QueryBundle; warning?: string }> {
    return { bundle: structuredClone(this.bundle) }
  }

  async save(bundle: QueryBundle): Promise<void> {
    this.bundle = structuredClone(bundle)
  }
}

export class ChromeBundleRepository implements QueryBundleRepository {
  constructor(private readonly key: string, private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}

  async load(): Promise<{ bundle: QueryBundle; warning?: string }> {
    const stored = await this.area.get(this.key)
    return readBundle(stored[this.key])
  }

  async save(bundle: QueryBundle): Promise<void> {
    await this.area.set({ [this.key]: bundle })
  }
}
