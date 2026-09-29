/** 前端写开关。没存过时默认打开。 */
export const WRITE_SWITCH_KEY = 'patmail.writeSwitch.v1'
export const WRITE_SWITCH_DEFAULT = true

let open = WRITE_SWITCH_DEFAULT
const listeners = new Set<() => void>()
let watching = false

function publish(): void {
  for (const listener of listeners) listener()
}

export function isWriteSwitchOpen(): boolean {
  return open
}

export function watchWriteSwitch(listener?: () => void): () => void {
  if (listener) listeners.add(listener)
  if (!watching && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(WRITE_SWITCH_KEY in changes)) return
      const next = changes[WRITE_SWITCH_KEY]?.newValue
      open = next === undefined ? WRITE_SWITCH_DEFAULT : next === true
      publish()
    })
  }
  return () => {
    if (listener) listeners.delete(listener)
  }
}

export async function hydrateWriteSwitch(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  try {
    const stored = await chrome.storage.local.get(WRITE_SWITCH_KEY)
    if (Object.prototype.hasOwnProperty.call(stored, WRITE_SWITCH_KEY)) {
      open = stored[WRITE_SWITCH_KEY] === true
      publish()
    }
  } catch {
    /* 读不到时保持默认打开 */
  }
}

export async function setWriteSwitchOpen(next: boolean): Promise<void> {
  open = next === true
  publish()
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  try {
    await chrome.storage.local.set({ [WRITE_SWITCH_KEY]: open })
  } catch {
    /* 当前页面已经按新值生效 */
  }
}
