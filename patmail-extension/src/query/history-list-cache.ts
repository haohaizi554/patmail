import type { HistoryQueryOption } from '../api/query-history'
import type { HistorySurface } from '../api/query-history/surfaces'

const STORAGE_KEY = 'patmail.historyQueryOptions'
const memory = new Map<string, HistoryQueryOption[]>()

function cacheKey(userId: string, surface: HistorySurface): string {
  return `${userId}:${surface}`
}

function isOption(value: unknown): value is HistoryQueryOption {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 80 &&
    typeof row.name === 'string' && row.name.trim().length > 0 && row.name.length <= 200 &&
    row.source === 'easy'
}

function copy(options: HistoryQueryOption[]): HistoryQueryOption[] {
  return options.map(item => ({ id: item.id, name: item.name, source: 'easy' }))
}

export function peekHistoryList(userId: string, surface: HistorySurface): HistoryQueryOption[] {
  return copy(memory.get(cacheKey(userId, surface)) ?? [])
}

export async function readHistoryList(userId: string, surface: HistorySurface): Promise<HistoryQueryOption[]> {
  const key = cacheKey(userId, surface)
  const hit = memory.get(key)
  if (hit) return copy(hit)
  const area = globalThis.chrome?.storage?.local
  if (!area || !userId) return []
  const stored = await area.get(STORAGE_KEY)
  const bag = stored[STORAGE_KEY]
  if (!bag || typeof bag !== 'object') return []
  const row = (bag as Record<string, unknown>)[key]
  if (!Array.isArray(row)) return []
  const options = row.filter(isOption).slice(0, 200)
  memory.set(key, options)
  return copy(options)
}

export function saveHistoryList(userId: string, surface: HistorySurface, options: HistoryQueryOption[]): void {
  if (!userId) return
  const key = cacheKey(userId, surface)
  const next = copy(options).slice(0, 200)
  memory.set(key, next)
  const area = globalThis.chrome?.storage?.local
  if (!area) return
  void area.get(STORAGE_KEY).then(stored => {
    const previous = stored[STORAGE_KEY]
    const bag = previous && typeof previous === 'object' ? { ...(previous as Record<string, HistoryQueryOption[]>) } : {}
    bag[key] = next
    return area.set({ [STORAGE_KEY]: bag })
  }).catch(() => undefined)
}
