import type { PageSnapshot } from '../shared/types'

/** 用户主动点击时才序列化整份快照；HTTP 页面使用隐藏 textarea 兼容复制。 */
export async function copySnapshot(snapshot: PageSnapshot, panel: HTMLElement): Promise<boolean> {
  const text = JSON.stringify(snapshot, null, 2)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 非安全 HTTP 上写入可能被拒绝，继续尝试浏览器兼容路径。
  }
  const root = panel.getRootNode()
  if (!(root instanceof ShadowRoot)) return false
  const prior = root.activeElement instanceof HTMLElement ? root.activeElement : null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none'
  root.append(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } finally {
    textarea.remove()
    prior?.focus()
  }
  return copied
}
