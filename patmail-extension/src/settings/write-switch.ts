/** 前端写开关。没存过时默认打开。扩展里要先读完存储，读完之前视为关闭。 */
export const WRITE_SWITCH_KEY = 'patmail.writeSwitch.v1'
export const WRITE_SWITCH_DEFAULT = true

function storageReady(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

let open = WRITE_SWITCH_DEFAULT
/** 没有扩展存储时（测试）直接用默认值。扩展进程里要等 hydrate。 */
let hydrated = !storageReady()
let ticket = 0
const listeners = new Set<() => void>()
let watching = false

function publish(): void {
  for (const listener of listeners) listener()
}

export function isWriteSwitchOpen(): boolean {
  return hydrated && open
}

export function isWriteSwitchReady(): boolean {
  return hydrated
}

export function watchWriteSwitch(listener?: () => void): () => void {
  if (listener) listeners.add(listener)
  if (!watching && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(WRITE_SWITCH_KEY in changes)) return
      const next = changes[WRITE_SWITCH_KEY]?.newValue
      open = next === undefined ? WRITE_SWITCH_DEFAULT : next === true
      hydrated = true
      publish()
    })
  }
  return () => {
    if (listener) listeners.delete(listener)
  }
}

export async function hydrateWriteSwitch(): Promise<void> {
  const mine = ++ticket
  if (!storageReady()) {
    if (mine !== ticket) return
    open = WRITE_SWITCH_DEFAULT
    hydrated = true
    publish()
    return
  }
  try {
    const stored = await chrome.storage.local.get(WRITE_SWITCH_KEY)
    if (mine !== ticket) return
    open = Object.prototype.hasOwnProperty.call(stored, WRITE_SWITCH_KEY)
      ? stored[WRITE_SWITCH_KEY] === true
      : WRITE_SWITCH_DEFAULT
  } catch {
    if (mine !== ticket) return
    open = false
  }
  hydrated = true
  publish()
}

export async function setWriteSwitchOpen(next: boolean): Promise<void> {
  ticket += 1
  open = next === true
  hydrated = true
  publish()
  if (!storageReady()) return
  try {
    await chrome.storage.local.set({ [WRITE_SWITCH_KEY]: open })
  } catch {
    /* 当前页面已经按新值生效 */
  }
}
