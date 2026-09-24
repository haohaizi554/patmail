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

function iframeInfo(frame: HTMLIFrameElement, doc: Document): IframeInfo {
  const raw = frame.getAttribute('src') ?? ''
  let sameOrigin = false
  try {
    const sandboxed = frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-same-origin')
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

/** 一次性读取顶层文档已有原生控件，不监听、不点击、不遍历 iframe/Shadow DOM。 */
export function scanPage(doc: Document = document): PageSnapshot {
  const started = performance.now()
  const page = pageMetadata(doc)
  const visible = createVisibilityDetector()
  const controls: PageSnapshot['controls'] = []
  const stats: PageScanStats = {
    totalControls: 0, inputs: 0, textareas: 0, selects: 0, buttons: 0,
    visible: 0, hidden: 0, disabled: 0, semanticResolved: 0, durationMs: 0
  }

  for (const element of Array.from(doc.querySelectorAll('input, textarea, select, button'))) {
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
  stats.totalControls = controls.length
  const iframes = Array.from(doc.querySelectorAll('iframe'))
    .filter(frame => !frame.closest('patmail-root'))
    .map(frame => iframeInfo(frame, doc))
  stats.durationMs = Math.round((performance.now() - started) * 100) / 100
  return { version: 2, page, controls, stats, iframes, scannedAt: new Date().toISOString() }
}

