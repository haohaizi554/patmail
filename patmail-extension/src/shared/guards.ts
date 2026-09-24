import type {
  FormControlSnapshot, IframeInfo, PageInfo, PageMetadata, PageScanStats, PageSnapshot,
  SelectOptionSnapshot
} from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => typeof value[key] === 'string')
}

function stringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isPageInfo(value: unknown): value is PageInfo {
  return isRecord(value) && strings(value, ['url', 'title', 'hostname'])
}

function isPageMetadata(value: unknown): value is PageMetadata {
  return isRecord(value) &&
    strings(value, ['url', 'origin', 'hostname', 'pathname', 'search', 'title']) &&
    nonnegative(value.iframeDepth) &&
    ['loading', 'interactive', 'complete'].includes(String(value.readyState))
}

function isOption(value: unknown): value is SelectOptionSnapshot {
  return isRecord(value) && strings(value, ['value', 'text']) &&
    typeof value.selected === 'boolean' && typeof value.disabled === 'boolean'
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isControl(value: unknown): value is FormControlSnapshot {
  if (!isRecord(value) || !strings(value, ['key', 'tagName', 'kind']) ||
    !['input', 'textarea', 'select', 'button'].includes(value.kind as string) ||
    !Array.isArray(value.classNames) || !value.classNames.every(name => typeof name === 'string') ||
    typeof value.visible !== 'boolean' || typeof value.disabled !== 'boolean' ||
    typeof value.readonly !== 'boolean' || typeof value.required !== 'boolean' ||
    !stringMap(value.attributes) || !stringMap(value.dataset)) return false
  if (!['inputType', 'id', 'name', 'value', 'displayValue', 'placeholder', 'title', 'label', 'ariaLabel', 'role', 'semanticName']
    .every(key => optionalString(value[key]))) return false
  if (['checked', 'selected', 'multiple'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) return false
  if (value.options !== undefined && (!Array.isArray(value.options) || !value.options.every(isOption))) return false
  if (value.semanticConfidence !== undefined &&
    (typeof value.semanticConfidence !== 'number' || value.semanticConfidence < 0 ||
      value.semanticConfidence > 1 || !Number.isFinite(value.semanticConfidence))) return false
  if (value.semanticSource !== undefined &&
    !['label', 'aria', 'title', 'placeholder', 'nearby', 'name', 'id'].includes(String(value.semanticSource))) return false
  return true
}

function isIframe(value: unknown): value is IframeInfo {
  return isRecord(value) && typeof value.src === 'string' && typeof value.sameOrigin === 'boolean'
}

function isStats(value: unknown): value is PageScanStats {
  return isRecord(value) &&
    ['totalControls', 'inputs', 'textareas', 'selects', 'buttons', 'visible', 'hidden',
      'disabled', 'semanticResolved', 'durationMs'].every(key => nonnegative(value[key]))
}

export function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (!isRecord(value) || value.version !== 2 || !isPageMetadata(value.page) ||
    !Array.isArray(value.controls) || !value.controls.every(isControl) ||
    !Array.isArray(value.iframes) || !value.iframes.every(isIframe) ||
    !isStats(value.stats) || typeof value.scannedAt !== 'string') return false
  const stats = value.stats
  return stats.totalControls === value.controls.length &&
    stats.totalControls === stats.inputs + stats.textareas + stats.selects + stats.buttons &&
    stats.totalControls === stats.visible + stats.hidden &&
    stats.disabled <= stats.totalControls && stats.semanticResolved <= stats.totalControls
}

