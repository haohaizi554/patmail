import type { DictionaryOption } from '../api/dictionaries/types'

export interface ResolvedDisplay {
  text: string
  unresolved: boolean
}

/** 只生成展示文案，不改写已经保存的内部 ID。 */
export function resolveInternalIdDisplay(value: string, options: DictionaryOption[], multiple = false): ResolvedDisplay {
  if (!value.trim()) return { text: '未设置', unresolved: false }
  const ids = multiple ? value.split(',').map(item => item.trim()).filter(Boolean) : [value.trim()]
  const labels = ids.map(id => options.find(item => item.value === id)?.label)
  if (labels.some(label => !label)) return { text: '未识别的历史 ID', unresolved: true }
  return { text: labels.join('、'), unresolved: false }
}

export function unknownIds(value: string, options: DictionaryOption[]): string[] {
  return value.split(',').map(item => item.trim()).filter(id => id && !options.some(item => item.value === id))
}
