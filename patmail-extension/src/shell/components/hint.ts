/** 悬停提示。气泡用工作台的粉色卡片，不走浏览器原生 title。 */

const STYLE = `
.patmail-hint {
  position: fixed;
  z-index: 2147483646;
  max-width: 260px;
  padding: 8px 12px;
  border: 1px solid #f6c5d8;
  border-radius: 12px;
  background: #fff;
  color: #243056;
  font: 12px/1.55 "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
  box-shadow: 0 10px 28px rgba(228, 69, 134, 0.16);
  pointer-events: none;
  white-space: pre-wrap;
}
.patmail-hint::before {
  content: "";
  position: absolute;
  left: var(--patmail-hint-arrow, 50%);
  transform: translateX(-50%);
  border: 6px solid transparent;
}
.patmail-hint[data-place="below"]::before { top: -12px; border-bottom-color: #f6c5d8; }
.patmail-hint[data-place="above"]::before { bottom: -12px; border-top-color: #f6c5d8; }
`

type HintHost = Document | ShadowRoot
type HintEl = HTMLElement & { __hintCleanup?: () => void; __hintText?: string }

function remember(el: HintEl, value: unknown): void {
  el.__hintText = typeof value === 'string' ? value.trim() : ''
}

function hostOf(el: HTMLElement): HintHost {
  const root = el.getRootNode()
  return root instanceof ShadowRoot ? root : document
}

function parentOf(root: HintHost): ParentNode {
  return root instanceof ShadowRoot ? root : document.body
}

function ensureStyle(root: HintHost): void {
  const parent = root instanceof ShadowRoot ? root : document.head
  if (parent.querySelector('style[data-patmail-hint]')) return
  const style = document.createElement('style')
  style.dataset.patmailHint = ''
  style.textContent = STYLE
  parent.appendChild(style)
}

function bubbleOf(root: HintHost): HTMLElement {
  ensureStyle(root)
  const parent = parentOf(root)
  const found = parent.querySelector(':scope > .patmail-hint')
  if (found instanceof HTMLElement) return found
  const bubble = document.createElement('div')
  bubble.className = 'patmail-hint'
  bubble.setAttribute('role', 'tooltip')
  bubble.hidden = true
  parent.appendChild(bubble)
  return bubble
}

function hideBubble(root: HintHost): void {
  const found = parentOf(root).querySelector(':scope > .patmail-hint')
  if (found instanceof HTMLElement) found.hidden = true
}

function showBubble(el: HTMLElement, text: string): void {
  const root = hostOf(el)
  const bubble = bubbleOf(root)
  bubble.textContent = text
  bubble.hidden = false
  const rect = el.getBoundingClientRect()
  const box = bubble.getBoundingClientRect()
  const gap = 10
  const center = rect.left + rect.width / 2
  const left = Math.max(8, Math.min(center - box.width / 2, window.innerWidth - box.width - 8))
  const spaceBelow = window.innerHeight - rect.bottom - gap
  const fitsBelow = spaceBelow + 16 >= box.height
  bubble.dataset.place = fitsBelow ? 'below' : 'above'
  bubble.style.setProperty('--patmail-hint-arrow', `${Math.round(center - left)}px`)
  bubble.style.left = `${Math.round(left)}px`
  bubble.style.top = `${Math.round(fitsBelow ? rect.bottom + gap : Math.max(8, rect.top - box.height - gap))}px`
  window.addEventListener('scroll', () => hideBubble(root), { capture: true, once: true })
}

export const hintDirective = {
  mounted(el: HintEl, binding: { value: unknown }) {
    remember(el, binding.value)
    const show = (): void => {
      const tip = el.__hintText ?? ''
      if (tip) showBubble(el, tip)
    }
    const hide = (): void => hideBubble(hostOf(el))
    el.addEventListener('mouseenter', show)
    el.addEventListener('mouseleave', hide)
    el.addEventListener('focusin', show)
    el.addEventListener('focusout', hide)
    el.__hintCleanup = () => {
      el.removeEventListener('mouseenter', show)
      el.removeEventListener('mouseleave', hide)
      el.removeEventListener('focusin', show)
      el.removeEventListener('focusout', hide)
      hide()
    }
  },
  updated(el: HintEl, binding: { value: unknown }) {
    remember(el, binding.value)
  },
  unmounted(el: HintEl) {
    el.__hintCleanup?.()
  }
}
