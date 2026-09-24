/** L2 快照只描述浏览器已渲染的原生控件，不映射业务字段。 */
export interface PageMetadata {
  url: string
  origin: string
  hostname: string
  pathname: string
  search: string
  title: string
  iframeDepth: number
  readyState: DocumentReadyState
}

export type FormControlKind = 'input' | 'textarea' | 'select' | 'button'
export type SemanticSource = 'label' | 'aria' | 'title' | 'placeholder' | 'nearby' | 'name' | 'id'

export interface SelectOptionSnapshot {
  value: string
  text: string
  selected: boolean
  disabled: boolean
}

export interface FormControlSnapshot {
  key: string
  tagName: string
  kind: FormControlKind
  inputType?: string
  id?: string
  name?: string
  value?: string
  displayValue?: string
  placeholder?: string
  title?: string
  label?: string
  ariaLabel?: string
  role?: string
  classNames: string[]
  visible: boolean
  disabled: boolean
  readonly: boolean
  required: boolean
  checked?: boolean
  selected?: boolean
  multiple?: boolean
  options?: SelectOptionSnapshot[]
  attributes: Record<string, string>
  dataset: Record<string, string>
  semanticName?: string
  semanticConfidence?: number
  semanticSource?: SemanticSource
}

export interface IframeInfo {
  src: string
  sameOrigin: boolean
}

export interface PageScanStats {
  totalControls: number
  inputs: number
  textareas: number
  selects: number
  buttons: number
  visible: number
  hidden: number
  disabled: number
  semanticResolved: number
  durationMs: number
}

export interface PageSnapshot {
  version: 2
  page: PageMetadata
  controls: FormControlSnapshot[]
  stats: PageScanStats
  iframes: IframeInfo[]
  scannedAt: string
}

export interface PageInfo {
  url: string
  title: string
  hostname: string
}

/** Popup 沿用轻量摘要接口，避免把整份快照塞入 UI。 */
export interface ScanSummary {
  url: string
  title: string
  hostname: string
  totalControls: number
  inputCount: number
  textareaCount: number
  selectCount: number
  buttonCount: number
  visibleCount: number
  hiddenCount: number
  semanticResolved: number
}

export function summarize(snapshot: PageSnapshot): ScanSummary {
  return {
    url: snapshot.page.url,
    title: snapshot.page.title,
    hostname: snapshot.page.hostname,
    totalControls: snapshot.stats.totalControls,
    inputCount: snapshot.stats.inputs,
    textareaCount: snapshot.stats.textareas,
    selectCount: snapshot.stats.selects,
    buttonCount: snapshot.stats.buttons,
    visibleCount: snapshot.stats.visible,
    hiddenCount: snapshot.stats.hidden,
    semanticResolved: snapshot.stats.semanticResolved
  }
}

