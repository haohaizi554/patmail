import type { IframeInfo, PageInfo, PageMetadata, PageScanStats, PageSnapshot } from '../shared/types'
import { sanitizeUrl } from './attribute-reader'
import { isNativeControl, scanControl } from './control-scanner'
import { createVisibilityDetector } from './visibility'

const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image'])

function pageMetadata(doc: Document): PageMetadata {
  const location = doc.location
  const safeUrl = new URL(sanitizeUrl(location.href))
  let iframeDepth = 0
  try {
    let frame = doc.defaultView?.frameElement
    while (frame && iframeDepth < 20) {
      iframeDepth++
      frame = frame.ownerDocument.defaultView?.frameElement ?? null
    }
  } catch {
    // 跨域父窗口不可访问；当前 manifest 只注入顶层文档。
  }
  return {
    url: safeUrl.href,
    origin: safeUrl.origin,
    hostname: safeUrl.hostname,
    pathname: safeUrl.pathname,
    search: safeUrl.search,
    title: doc.title,
    iframeDepth,
    readyState: doc.readyState
  }
}

function iframeInfo(frame: HTMLIFrameElement | HTMLFrameElement, doc: Document): IframeInfo {
  const raw = frame.getAttribute('src') ?? ''
  let sameOrigin = false
  try {
    const sandboxed = frame instanceof HTMLIFrameElement && frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-same-origin')
    const url = new URL(raw || 'about:blank', doc.baseURI)
    sameOrigin = !sandboxed && (raw === '' || url.protocol === 'about:' || url.origin === doc.location.origin)
  } catch {
    sameOrigin = false
  }
  return { src: raw ? sanitizeUrl(raw, doc.baseURI) : '', sameOrigin }
}

export function readPageInfo(doc: Document = document): PageInfo {
  const page = pageMetadata(doc)
  return { url: page.url, title: page.title, hostname: page.hostname }
}

function frameDocument(frame: HTMLIFrameElement | HTMLFrameElement, doc: Document): Document | null {
  if (!iframeInfo(frame, doc).sameOrigin) return null
  try {
    return frame.contentDocument
  } catch {
    return null
  }
}

/** 业务页在同源 frame 里。只读这些文档，不进入跨域页，也不进 Shadow DOM。 */
function documentsToScan(root: Document): Document[] {
  const docs: Document[] = []
  const seen = new Set<Document>()
  const walk = (doc: Document): void => {
    if (seen.has(doc) || docs.length >= 12) return
    seen.add(doc)
    docs.push(doc)
    for (const frame of Array.from(doc.querySelectorAll('iframe, frame'))) {
      if (!(frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)) continue
      if (frame.closest('patmail-root')) continue
      const child = frameDocument(frame, doc)
      if (child) walk(child)
    }
  }
  walk(root)
  return docs
}

function controlCount(doc: Document): number {
  return doc.querySelectorAll('input, textarea, select, button').length
}

function pageToShow(docs: Document[]): Document {
  const usable = docs.filter(doc => {
    try { return /^https?:/i.test(doc.location.href) } catch { return false }
  })
  const pool = usable.length ? usable : docs
  return pool.reduce((best, doc) => controlCount(doc) > controlCount(best) ? doc : best)
}

/** 读取当前外层页面和已打开的同源内页。不监听、不点击。 */
export function scanPage(doc: Document = document): PageSnapshot {
  const started = performance.now()
  const docs = documentsToScan(doc)
  const page = pageMetadata(pageToShow(docs))
  const visible = createVisibilityDetector()
  const controls: PageSnapshot['controls'] = []
  const stats: PageScanStats = {
    totalControls: 0, inputs: 0, textareas: 0, selects: 0, buttons: 0,
    visible: 0, hidden: 0, disabled: 0, semanticResolved: 0, durationMs: 0
  }

  for (const current of docs) {
    for (const element of Array.from(current.querySelectorAll('input, textarea, select, button'))) {
      if (!isNativeControl(element) || element.closest('patmail-root')) continue
      const control = scanControl(element, controls.length, visible(element))
      controls.push(control)
      if (control.kind === 'input') {
        if (BUTTON_INPUT_TYPES.has(control.inputType ?? '')) stats.buttons++
        else stats.inputs++
      } else if (control.kind === 'textarea') stats.textareas++
      else if (control.kind === 'select') stats.selects++
      else stats.buttons++
      if (control.visible) stats.visible++
      else stats.hidden++
      if (control.disabled) stats.disabled++
      if (control.semanticName) stats.semanticResolved++
    }
  }
  stats.totalControls = controls.length
  const iframes = Array.from(doc.querySelectorAll('iframe, frame'))
    .filter((frame): frame is HTMLIFrameElement | HTMLFrameElement =>
      (frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement) && !frame.closest('patmail-root'))
    .map(frame => iframeInfo(frame, doc))
  stats.durationMs = Math.round((performance.now() - started) * 100) / 100
  return { version: 2, page, controls, stats, iframes, scannedAt: new Date().toISOString() }
}

