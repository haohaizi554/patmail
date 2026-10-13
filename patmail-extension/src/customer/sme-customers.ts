import type { CustomerListSnapshot } from '../api/dictionaries/types'
import { apiError, type ApiResult } from '../api/types'
import { isQueryGuid } from '../query/query-validator'
import { customerMode, hydrateCustomerMode } from '../settings/customer-mode'
import type { EasyCustomerOption } from './customer-list'

const NAME_LIMIT = 200
const MAX_CUSTOMERS = 50_000
const SNAPSHOT_WAIT_MS = 8_000

export const SME_SNAPSHOT_MISSING = '中小客户名单快照没有读到（assets/sme-customers.json 缺失或无效）。跑一次 scripts/pull-sme-customers.py 再重新构建扩展。'

export interface SmeCustomerSnapshot {
  /** 快照的拉取时间，ISO 格式。展示用。 */
  takenAt: string
  customers: EasyCustomerOption[]
}

/** 解析 scripts/pull-sme-customers.py 写出的快照文件。结构不对、超量或没有一行能对上编号时，当作没有快照，明确报错。 */
export function parseSmeCustomerSnapshot(data: unknown): SmeCustomerSnapshot | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as { takenAt?: unknown; customers?: unknown }
  if (typeof raw.takenAt !== 'string' || !Array.isArray(raw.customers) || raw.customers.length > MAX_CUSTOMERS) return null
  const customers: EasyCustomerOption[] = []
  const seen = new Set<string>()
  for (const row of raw.customers) {
    if (!Array.isArray(row) || row.length < 2) return null
    const id = typeof row[0] === 'string' ? row[0].trim() : ''
    const name = typeof row[1] === 'string' ? row[1].trim() : ''
    if (!id || !name) continue
    if (!isQueryGuid(id) || name.length > NAME_LIMIT) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    customers.push({ id, name })
  }
  if (!customers.length) return null
  return { takenAt: raw.takenAt.slice(0, 40), customers }
}

let cached: SmeCustomerSnapshot | null | undefined

/**
 * 中小客户的客户名单走打包好的数据库快照，不走原站 GetCustomerlist（三万多家，响应要二三十分钟）。
 * 只能在扩展页面或后台里读：内容脚本里 fetch chrome-extension:// 会把未打包扩展锁死，读不回来就一直等到请求超时。
 * 快照作为构建产物放在 chunks 里，用 import.meta.url 定位。文件没打包或解析不了时返回 null，调用方明确报错。
 */
export async function loadSmeCustomerSnapshot(force = false): Promise<SmeCustomerSnapshot | null> {
  if (!force && cached !== undefined) return cached
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SNAPSHOT_WAIT_MS)
  try {
    // Vite 把 JSON 当资源打进 chunks/，URL 跟着构建产物走，不被 public 目录的复制锁影响。
    const url = new URL('../assets/sme-customers.json', import.meta.url).href
    const response = await fetch(force ? `${url}?t=${Date.now()}` : url, { signal: controller.signal })
    if (!response.ok) {
      cached = null
      return null
    }
    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      cached = null
      return null
    }
    cached = parseSmeCustomerSnapshot(data)
  } catch {
    cached = null
  } finally {
    clearTimeout(timer)
  }
  return cached
}

/**
 * 中小客户名单只在扩展自己的页面或后台里读。返回 null 表示当前不是中小客户，调用方再走原站。
 * 内容脚本各有一份客户模式，默认是大客户；这里先等存储里的模式到位，避免没读完就去打 GetCustomerlist。
 */
export async function readSmeCustomerList(force: boolean): Promise<ApiResult<CustomerListSnapshot> | null> {
  await hydrateCustomerMode()
  if (customerMode() !== 'sme') return null
  const snapshot = await loadSmeCustomerSnapshot(force)
  if (!snapshot) return apiError('BUSINESS_ERROR', SME_SNAPSHOT_MISSING)
  return { ok: true, data: { kind: 'customerList', customers: snapshot.customers, takenAt: snapshot.takenAt } }
}