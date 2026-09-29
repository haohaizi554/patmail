import { isFileSearchBusinessField } from '../api/file-search-params'
import type { FileSearchFormField } from '../shared/message'
import { formFieldKey } from './form-page'
import { primaryQueryKeys, type QueryCell } from './form-layout'

function toCell(field: FileSearchFormField, key: string): QueryCell | null {
  const label = field.label.trim() || key
  if (key === 'filetype') return { kind: 'files', key, label }
  if (field.control === 'check') return { kind: 'checks', label, items: [{ key, label }] }
  if (field.control === 'select') return { kind: 'select', key, label }
  if (field.control === 'picker') return { kind: 'named', key, label }
  if (field.control === 'text') return { kind: 'text', key, label }
  return null
}

/** 原网站查询页上、第一屏之外、当前能看见的条件。藏起来的不放进来。 */
export function cellsFromLiveFields(fields: readonly FileSearchFormField[]): { case: QueryCell[]; file: QueryCell[] } {
  const primary = primaryQueryKeys()
  const seen = new Set<string>()
  const grouped = { case: [] as QueryCell[], file: [] as QueryCell[] }
  for (const field of fields) {
    if (!field.visible) continue
    const key = formFieldKey(field.id)
    if (!key || !isFileSearchBusinessField(key) || primary.has(key) || seen.has(key)) continue
    const cell = toCell(field, key)
    if (!cell) continue
    seen.add(key)
    grouped[field.section === 'file' ? 'file' : 'case'].push(cell)
  }
  return grouped
}
