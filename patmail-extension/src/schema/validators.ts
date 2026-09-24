import { assessQueryScope } from '../query/query-scope'
import { isFileSearchBusinessField } from '../api/file-search-params'
import { isForbiddenFieldName } from '../query/field-registry'

export function formValuesToFields(values: Record<string, string>): Record<string, string> {
  const fields = Object.create(null) as Record<string, string>
  for (const key of Object.keys(values)) {
    if (isForbiddenFieldName(key) || !isFileSearchBusinessField(key)) continue
    const value = values[key]
    if (typeof value !== 'string' || !value.trim()) continue
    Object.defineProperty(fields, key, { value: value.trim(), enumerable: true, writable: true, configurable: true })
  }
  return fields
}

export function formHasQueryScope(values: Record<string, string>): boolean {
  return assessQueryScope(formValuesToFields(values)).sufficient
}
