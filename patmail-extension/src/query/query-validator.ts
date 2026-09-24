import { isFileSearchBusinessField } from '../api/file-search-params'
import { isForbiddenFieldName } from './field-registry'
import type { QueryTemplate } from './query-types'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isQueryGuid(value: string): boolean {
  return GUID.test(value)
}

function stringRecord(value: unknown, registeredOnly: boolean): Record<string, string> | null {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const output = Object.create(null) as Record<string, string>
  for (const key of Object.keys(value as object)) {
    const raw = (value as Record<string, unknown>)[key]
    if (isForbiddenFieldName(key) || typeof raw !== 'string') return null
    if (registeredOnly && !isFileSearchBusinessField(key)) return null
    if (!registeredOnly && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null
    output[key] = raw
  }
  return output
}

export function isQueryTemplate(value: unknown): value is QueryTemplate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const template = value as Record<string, unknown>
  if (typeof template.id !== 'string' || !template.id.trim()) return false
  if (typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80) return false
  if (template.source !== 'local' && template.source !== 'easy') return false
  if (template.queryType !== 'FileSearch') return false
  if (template.sourceQueryId !== undefined && (typeof template.sourceQueryId !== 'string' || !isQueryGuid(template.sourceQueryId))) return false
  if (!Number.isSafeInteger(template.version) || Number(template.version) < 1) return false
  if (typeof template.createdAt !== 'string' || typeof template.updatedAt !== 'string') return false
  return stringRecord(template.fields, true) !== null &&
    stringRecord(template.displayValues, true) !== null &&
    stringRecord(template.unknownFields, false) !== null
}

export function cloneTemplate(template: QueryTemplate): QueryTemplate {
  return {
    ...template,
    fields: { ...template.fields },
    ...(template.displayValues ? { displayValues: { ...template.displayValues } } : {}),
    ...(template.unknownFields ? { unknownFields: { ...template.unknownFields } } : {}),
    ...(template.sourceQueryId ? { sourceQueryId: template.sourceQueryId } : {})
  }
}
