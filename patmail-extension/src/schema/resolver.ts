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

export interface FileDescriptionDisplay {
  ids: string[]
  labels: string[]
  resolved: boolean
  unresolvedIds: string[]
  text: string
}

/** 手工查询和历史模板共用。历史显示文本不能把未解析 ID 标成已解析。 */
export function resolveFileDescriptionDisplay(input: {
  savedIds: string
  descriptions?: Array<{ id: string; name: string }>
  historyText?: string
}): FileDescriptionDisplay {
  const ids = input.savedIds.split(',').map(item => item.trim()).filter(Boolean)
  const descriptions = input.descriptions ?? []
  const labels: string[] = []
  const unresolvedIds: string[] = []
  for (const id of ids) {
    const name = descriptions.find(item => item.id === id)?.name
    if (name) labels.push(name)
    else unresolvedIds.push(id)
  }
  const resolved = ids.length > 0 && unresolvedIds.length === 0
  const history = input.historyText?.trim() ?? ''
  let text = '未设置'
  if (ids.length === 0) text = '未设置'
  else if (resolved) text = labels.join('、')
  else if (history) text = `${history}（未识别的历史 ID）`
  else text = '未识别的历史 ID'
  return { ids, labels, resolved, unresolvedIds, text }
}
