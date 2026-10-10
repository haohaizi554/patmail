import { LARGE_CUSTOMER_ORIGIN, PCL_ORIGIN, SME_CUSTOMER_ORIGIN } from '../api/config'

/** 大客户走 66，中小客户走 44。中小客户先复用大客户的全部能力。 */
export type CustomerMode = 'large' | 'sme'

export const CUSTOMER_MODE_KEY = 'patmail.customerMode.v1'
export const CUSTOMER_MODE_DEFAULT: CustomerMode = 'large'

export function isCustomerMode(value: unknown): value is CustomerMode {
  return value === 'large' || value === 'sme'
}

export function modeOrigin(mode: CustomerMode): string {
  return mode === 'sme' ? SME_CUSTOMER_ORIGIN : LARGE_CUSTOMER_ORIGIN
}

export function modeLabel(mode: CustomerMode): string {
  return mode === 'sme' ? '中小客户' : '大客户'
}

/** 大客户模式仍包含原来的 66 和鹏城。中小客户只连 44。 */
export function originsForMode(mode: CustomerMode): readonly string[] {
  return mode === 'sme' ? [SME_CUSTOMER_ORIGIN] : [LARGE_CUSTOMER_ORIGIN, PCL_ORIGIN]
}

export function originMatchesMode(origin: string, mode: CustomerMode = customerMode()): boolean {
  return originsForMode(mode).includes(origin)
}

function storageReady(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

let mode: CustomerMode = CUSTOMER_MODE_DEFAULT
let hydrated = !storageReady()
let ticket = 0
const listeners = new Set<() => void>()
let watching = false

function publish(): void {
  for (const listener of listeners) listener()
}

export function customerMode(): CustomerMode {
  return mode
}

export function watchCustomerMode(listener?: () => void): () => void {
  if (listener) listeners.add(listener)
  if (!watching && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(CUSTOMER_MODE_KEY in changes)) return
      const next = changes[CUSTOMER_MODE_KEY]?.newValue
      mode = isCustomerMode(next) ? next : CUSTOMER_MODE_DEFAULT
      hydrated = true
      publish()
    })
  }
  return () => {
    if (listener) listeners.delete(listener)
  }
}

export async function hydrateCustomerMode(): Promise<void> {
  const mine = ++ticket
  if (!storageReady()) {
    if (mine !== ticket) return
    hydrated = true
    publish()
    return
  }
  try {
    const stored = await chrome.storage.local.get(CUSTOMER_MODE_KEY)
    if (mine !== ticket) return
    const next = stored[CUSTOMER_MODE_KEY]
    mode = isCustomerMode(next) ? next : CUSTOMER_MODE_DEFAULT
  } catch {
    if (mine !== ticket) return
    mode = CUSTOMER_MODE_DEFAULT
  }
  hydrated = true
  publish()
}

export function isCustomerModeReady(): boolean {
  return hydrated
}

export async function setCustomerMode(next: CustomerMode): Promise<void> {
  ticket += 1
  mode = next
  hydrated = true
  publish()
  if (!storageReady()) return
  try {
    await chrome.storage.local.set({ [CUSTOMER_MODE_KEY]: mode })
  } catch {
    /* 当前页面已经按新模式生效 */
  }
}
