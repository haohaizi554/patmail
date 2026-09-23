import type { ButtonInfo, InputInfo, PageInfo, PageSnapshot, SelectInfo } from '../shared/types'

const BUTTON_INPUT_TYPES = ['button', 'submit', 'reset', 'image']

function textOf(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function isOwnUi(element: Element): boolean {
  return Boolean(element.closest('patmail-root'))
}

function readControlValue(element: HTMLInputElement | HTMLTextAreaElement): string {
  if (element instanceof HTMLInputElement && ['password', 'file'].includes(element.type)) return ''
  return element.value ?? ''
}

function readInputs(root: ParentNode): InputInfo[] {
  const fields = root.querySelectorAll('input, textarea')
  const result: InputInfo[] = []
  fields.forEach((node) => {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return
    if (isOwnUi(node)) return
    if (node instanceof HTMLInputElement && BUTTON_INPUT_TYPES.includes(node.type)) return
    result.push({
      tag: node instanceof HTMLTextAreaElement ? 'textarea' : 'input',
      type: node instanceof HTMLTextAreaElement ? 'textarea' : node.type || 'text',
      name: node.name || '',
      id: node.id || '',
      placeholder: node.placeholder || '',
      value: readControlValue(node)
    })
  })
  return result
}

function readSelects(root: ParentNode): SelectInfo[] {
  const result: SelectInfo[] = []
  root.querySelectorAll('select').forEach((node) => {
    if (!(node instanceof HTMLSelectElement) || isOwnUi(node)) return
    const options = Array.from(node.options).map((option) => textOf(option.label || option.text))
    result.push({
      tag: 'select',
      name: node.name || '',
      id: node.id || '',
      value: node.value || '',
      options
    })
  })
  return result
}

function readButtons(root: ParentNode): ButtonInfo[] {
  const result: ButtonInfo[] = []
  root.querySelectorAll('button, input').forEach((node) => {
    if (isOwnUi(node)) return
    if (node instanceof HTMLButtonElement) {
      result.push({
        tag: 'button',
        type: node.type || 'button',
        id: node.id || '',
        name: node.name || '',
        text: textOf(node.innerText || node.textContent || node.value)
      })
      return
    }
    if (node instanceof HTMLInputElement && BUTTON_INPUT_TYPES.includes(node.type)) {
      result.push({
        tag: 'input',
        type: node.type,
        id: node.id || '',
        name: node.name || '',
        text: textOf(node.type === 'image' ? node.alt || node.value : node.value)
      })
    }
  })
  return result
}

export function readPageInfo(doc: Document = document): PageInfo {
  return {
    url: doc.location.href,
    title: doc.title,
    hostname: doc.location.hostname
  }
}

/** 采集当前文档的表单结构，不做字段含义识别。 */
export function scanPage(doc: Document = document): PageSnapshot {
  return {
    ...readPageInfo(doc),
    inputs: readInputs(doc),
    selects: readSelects(doc),
    buttons: readButtons(doc)
  }
}
