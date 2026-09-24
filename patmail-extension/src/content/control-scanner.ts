import type { FormControlKind, FormControlSnapshot, SelectOptionSnapshot } from '../shared/types'
import { isSensitiveName, readAttributes, REDACTED } from './attribute-reader'
import { explicitLabel, nearbyLabel } from './label-resolver'
import { resolveSemantic } from './semantic-resolver'

type NativeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement

function controlKind(element: NativeControl): FormControlKind {
  if (element instanceof HTMLTextAreaElement) return 'textarea'
  if (element instanceof HTMLSelectElement) return 'select'
  if (element instanceof HTMLButtonElement) return 'button'
  return 'input'
}

function sensitiveControl(element: NativeControl): boolean {
  return (element instanceof HTMLInputElement && ['password', 'file', 'hidden'].includes(element.type)) ||
    [element.id, element.getAttribute('name') ?? '', element.getAttribute('autocomplete') ?? ''].some(isSensitiveName)
}

function optionsOf(element: HTMLSelectElement, redact: boolean): SelectOptionSnapshot[] {
  return Array.from(element.options).map(option => ({
    value: redact ? REDACTED : option.value,
    text: redact ? REDACTED : option.text.trim(),
    selected: option.selected,
    disabled: option.disabled || Boolean(option.closest('optgroup[disabled]'))
  }))
}

/** 不长期保存 DOM 引用；key 用同次扫描中的序号消除重复 id/name 冲突。 */
export function scanControl(element: NativeControl, index: number, visible: boolean): FormControlSnapshot {
  const kind = controlKind(element)
  const redact = sensitiveControl(element)
  const label = explicitLabel(element)
  const nearby = label ? undefined : nearbyLabel(element)
  const id = element.id || undefined
  const name = element.getAttribute('name') || undefined
  const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.placeholder || undefined : undefined
  const ariaLabel = element.getAttribute('aria-label') || undefined
  const title = element.title || undefined
  const options = element instanceof HTMLSelectElement ? optionsOf(element, redact) : undefined
  const rawValue = redact ? REDACTED : element instanceof HTMLButtonElement
    ? element.value || element.textContent?.trim() || '' : element.value
  const displayValue = redact ? REDACTED : element instanceof HTMLSelectElement
    ? Array.from(element.selectedOptions).map(option => option.text.trim()).join(', ') :
      element instanceof HTMLButtonElement ? element.textContent?.trim() || element.value :
        element instanceof HTMLInputElement && element.type === 'image' ? element.alt || element.value : rawValue
  const { attributes, dataset } = readAttributes(element)
  const semantic = resolveSemantic([
    { value: label, source: 'label', confidence: 1 },
    { value: ariaLabel, source: 'aria', confidence: 0.9 },
    { value: title, source: 'title', confidence: 0.8 },
    { value: placeholder, source: 'placeholder', confidence: 0.7 },
    { value: nearby, source: 'nearby', confidence: 0.6 },
    { value: name, source: 'name', confidence: 0.4 },
    { value: id, source: 'id', confidence: 0.3 }
  ])
  return {
    key: `${kind}:${id ?? name ?? 'anonymous'}:${index}`,
    tagName: element.tagName.toLowerCase(), kind,
    ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    id, name, value: rawValue, displayValue, placeholder, title, label: label ?? nearby, ariaLabel,
    role: element.getAttribute('role') || undefined,
    classNames: Array.from(element.classList), visible,
    disabled: element.disabled || element.matches(':disabled'),
    readonly: (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly,
    required: !(element instanceof HTMLButtonElement) && element.required,
    ...(element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? { checked: element.checked } : {}),
    ...(element instanceof HTMLSelectElement ? { selected: element.selectedOptions.length > 0, multiple: element.multiple, options } : {}),
    attributes, dataset, ...semantic
  }
}

export function isNativeControl(element: Element): element is NativeControl {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement || element instanceof HTMLButtonElement
}
