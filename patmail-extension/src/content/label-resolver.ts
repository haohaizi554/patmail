const MAX_LABEL_LENGTH = 120
const MAX_NEARBY_DEPTH = 3
const TEXTUAL_TAGS = new Set(['TD', 'TH', 'SPAN', 'LABEL', 'STRONG', 'B', 'SMALL', 'P'])

function normalized(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text && text.length <= MAX_LABEL_LENGTH ? text : undefined
}

function candidateText(element: Element | null): string | undefined {
  if (!element || !TEXTUAL_TAGS.has(element.tagName) ||
    element.querySelector('input, select, textarea, button')) return undefined
  return normalized(element.textContent)
}

/** 原生 labels 覆盖 for 和嵌套 label；也读取 aria-labelledby。 */
export function explicitLabel(element: HTMLElement): string | undefined {
  const view = element.ownerDocument.defaultView ?? window
  if (element instanceof view.HTMLInputElement || element instanceof view.HTMLSelectElement ||
      element instanceof view.HTMLTextAreaElement || element instanceof view.HTMLButtonElement) {
    const labels = Array.from(element.labels ?? []).map(label => normalized(label.textContent)).filter(Boolean)
    if (labels.length) return labels.join(' / ').slice(0, MAX_LABEL_LENGTH)
  }
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean).slice(0, 3) ?? []
  const texts = ids.map(id => normalized(element.ownerDocument.getElementById(id)?.textContent)).filter(Boolean)
  return texts.length ? texts.join(' / ').slice(0, MAX_LABEL_LENGTH) : undefined
}

/** 只看控件及至多两层容器的前邻居，适配表格与简单 div 表单。 */
export function nearbyLabel(element: HTMLElement): string | undefined {
  let cursor: Element | null = element
  for (let depth = 0; cursor && depth < MAX_NEARBY_DEPTH; depth++, cursor = cursor.parentElement) {
    const text = candidateText(cursor.previousElementSibling)
    if (text) return text
    const sibling = cursor.previousSibling
    if (sibling?.nodeType === Node.TEXT_NODE) {
      const directText = normalized(sibling.textContent)
      if (directText) return directText
    }
  }
  return undefined
}
