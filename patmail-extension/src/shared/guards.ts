import type { ButtonInfo, InputInfo, PageInfo, PageSnapshot, SelectInfo } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => typeof value[key] === 'string')
}

export function isPageInfo(value: unknown): value is PageInfo {
  return isRecord(value) && strings(value, ['url', 'title', 'hostname'])
}

function isInput(value: unknown): value is InputInfo {
  return isRecord(value) && (value.tag === 'input' || value.tag === 'textarea') &&
    strings(value, ['type', 'name', 'id', 'placeholder', 'value'])
}

function isSelect(value: unknown): value is SelectInfo {
  return isRecord(value) && value.tag === 'select' && strings(value, ['name', 'id', 'value']) &&
    Array.isArray(value.options) && value.options.every(option => typeof option === 'string')
}

function isButton(value: unknown): value is ButtonInfo {
  return isRecord(value) && (value.tag === 'button' || value.tag === 'input') &&
    strings(value, ['type', 'id', 'name', 'text'])
}

export function isPageSnapshot(value: unknown): value is PageSnapshot {
  return isRecord(value) && isPageInfo(value) &&
    Array.isArray(value.inputs) && value.inputs.every(isInput) &&
    Array.isArray(value.selects) && value.selects.every(isSelect) &&
    Array.isArray(value.buttons) && value.buttons.every(isButton)
}
