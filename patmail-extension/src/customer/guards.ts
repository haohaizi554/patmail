import { isFileSearchBusinessField } from '../api/file-search-params'
import { isForbiddenFieldName } from '../query/field-registry'
import { isQueryGuid } from '../query/query-validator'
import type { CustomerQueryProfile } from './types'

export function isCustomerProfile(value: unknown): value is CustomerQueryProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Record<string, unknown>
  if (typeof profile.id !== 'string' || !profile.id.trim()) return false
  if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 80) return false
  if (profile.easyCustomerId !== undefined && (typeof profile.easyCustomerId !== 'string' || !isQueryGuid(profile.easyCustomerId))) return false
  if (typeof profile.baseTemplateId !== 'string' || !profile.baseTemplateId.trim()) return false
  if (typeof profile.enabled !== 'boolean') return false
  if (typeof profile.createdAt !== 'string' || typeof profile.updatedAt !== 'string') return false
  if (profile.overrides === null || typeof profile.overrides !== 'object' || Array.isArray(profile.overrides)) return false
  for (const key of Object.keys(profile.overrides as object)) {
    const raw = (profile.overrides as Record<string, unknown>)[key]
    if (isForbiddenFieldName(key) || !isFileSearchBusinessField(key) || typeof raw !== 'string') return false
  }
  return true
}
