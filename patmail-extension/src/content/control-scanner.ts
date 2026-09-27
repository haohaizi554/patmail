import type { FormControlKind, FormControlSnapshot, SelectOptionSnapshot } from '../shared/types'
import { isSensitiveName, readAttributes, REDACTED } from './attribute-reader'
import { explicitLabel, nearbyLabel } from './label-resolver'
import { resolveSemantic } from './semantic-resolver'

type NativeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement

function realm(element: Element): Window {
  return element.ownerDocument.defaultView ?? window
}

export function isInputElement(element: Element): element is HTMLInputElement {
  return element instanceof realm(element).HTMLInputElement
}

function isTextAreaElement(element: Element): element is HTMLTextAreaElement {
  return element instanceof realm(element).HTMLTextAreaElement
}

function isSelectElement(element: Element): element is HTMLSelectElement {
  return element instanceof realm(element).HTMLSelectElement
}

function isButtonElement(element: Element): element is HTMLButtonElement {
  return element instanceof realm(element).HTMLButtonElement
}

function controlKind(element: NativeControl): FormControlKind {
  if (isTextAreaElement(element)) return 'textarea'
  if (isSelectElement(element)) return 'select'
  if (isButtonElement(element)) return 'button'
  return 'input'
}

function sensitiveControl(element: NativeControl): boolean {
  return (isInputElement(element) && ['password', 'file', 'hidden'].includes(element.type)) ||
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
  const placeholder = isInputElement(element) || isTextAreaElement(element)
    ? element.placeholder || undefined : undefined
  const ariaLabel = element.getAttribute('aria-label') || undefined
  const title = element.title || undefined
  const options = isSelectElement(element) ? optionsOf(element, redact) : undefined
  const rawValue = redact ? REDACTED : isButtonElement(element)
    ? element.value || element.textContent?.trim() || '' : element.value
  const displayValue = redact ? REDACTED : isSelectElement(element)
    ? Array.from(element.selectedOptions).map(option => option.text.trim()).join(', ') :
      isButtonElement(element) ? element.textContent?.trim() || element.value :
        isInputElement(element) && element.type === 'image' ? element.alt || element.value : rawValue
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
    ...(isInputElement(element) ? { inputType: element.type } : {}),
    id, name, value: rawValue, displayValue, placeholder, title, label: label ?? nearby, ariaLabel,
    role: element.getAttribute('role') || undefined,
    classNames: Array.from(element.classList), visible,
    disabled: element.disabled || element.matches(':disabled'),
    readonly: (isInputElement(element) || isTextAreaElement(element)) && element.readOnly,
    required: !isButtonElement(element) && element.required,
    ...(isInputElement(element) && ['checkbox', 'radio'].includes(element.type) ? { checked: element.checked } : {}),
    ...(isSelectElement(element) ? { selected: element.selectedOptions.length > 0, multiple: element.multiple, options } : {}),
    attributes, dataset, ...semantic
  }
}

export function isNativeControl(element: Element): element is NativeControl {
  return isInputElement(element) || isTextAreaElement(element) || isSelectElement(element) || isButtonElement(element)
}
