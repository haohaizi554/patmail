import { fileSearchTimeoutMs, type FileSearchTimeoutMs } from './file-search-params'

const KEY = 'patmail.limitMonitor.timeoutMs'
let cached: FileSearchTimeoutMs | null = null
let generation = 0

function storage(): chrome.storage.LocalStorageArea | null {
  return globalThis.chrome?.storage?.local ?? null
}

/** 下拉一改就记下。后面的期限查询按这次选择等待，不再固定一分钟。 */
export function writeLimitTimeout(value: unknown): FileSearchTimeoutMs {
  const next = fileSearchTimeoutMs(value)
  cached = next
  generation += 1
  void storage()?.set({ [KEY]: next })
  return next
}

/** 发请求时再读一次。表格自动查询不经过查询按钮，也要拿到当前下拉。 */
export function readLimitTimeout(): Promise<FileSearchTimeoutMs> {
  if (cached != null) return Promise.resolve(cached)
  const area = storage()
  if (!area) {
    cached = 60_000
    return Promise.resolve(cached)
  }
  const ticket = generation
  return area.get(KEY).then(stored => {
    if (ticket !== generation && cached != null) return cached
    cached = fileSearchTimeoutMs(stored[KEY])
    return cached
  }).catch(() => {
    if (cached != null) return cached
    cached = 60_000
    return cached
  })
}
