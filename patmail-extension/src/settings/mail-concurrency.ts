/** 发文阶段同时提交的封数。没存过时是 1，一封有结果再发下一封。 */
export const MAIL_CONCURRENCY_KEY = 'patmail.mailConcurrency.v1'
export const MAIL_CONCURRENCY_MIN = 1
export const MAIL_CONCURRENCY_MAX = 4
export const MAIL_CONCURRENCY_DEFAULT = 1

function storageReady(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

let width = MAIL_CONCURRENCY_DEFAULT
let hydrated = !storageReady()
let ticket = 0
const listeners = new Set<() => void>()
let watching = false

function publish(): void {
  for (const listener of listeners) listener()
}

export function clampMailConcurrency(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed)) return MAIL_CONCURRENCY_DEFAULT
  return Math.min(MAIL_CONCURRENCY_MAX, Math.max(MAIL_CONCURRENCY_MIN, parsed))
}

export function mailConcurrency(): number {
  return width
}

export function isMailConcurrencyReady(): boolean {
  return hydrated
}

export function watchMailConcurrency(listener?: () => void): () => void {
  if (listener) listeners.add(listener)
  if (!watching && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(MAIL_CONCURRENCY_KEY in changes)) return
      width = clampMailConcurrency(changes[MAIL_CONCURRENCY_KEY]?.newValue)
      hydrated = true
      publish()
    })
  }
  return () => {
    if (listener) listeners.delete(listener)
  }
}

export async function hydrateMailConcurrency(): Promise<void> {
  const mine = ++ticket
  if (!storageReady()) {
    if (mine !== ticket) return
    width = MAIL_CONCURRENCY_DEFAULT
    hydrated = true
    publish()
    return
  }
  try {
    const stored = await chrome.storage.local.get(MAIL_CONCURRENCY_KEY)
    if (mine !== ticket) return
    width = Object.prototype.hasOwnProperty.call(stored, MAIL_CONCURRENCY_KEY)
      ? clampMailConcurrency(stored[MAIL_CONCURRENCY_KEY])
      : MAIL_CONCURRENCY_DEFAULT
  } catch {
    if (mine !== ticket) return
    width = MAIL_CONCURRENCY_DEFAULT
  }
  hydrated = true
  publish()
}

export async function setMailConcurrency(next: number): Promise<void> {
  ticket += 1
  width = clampMailConcurrency(next)
  hydrated = true
  publish()
  if (!storageReady()) return
  try {
    await chrome.storage.local.set({ [MAIL_CONCURRENCY_KEY]: width })
  } catch {
    /* 当前页面已经按新值生效 */
  }
}
