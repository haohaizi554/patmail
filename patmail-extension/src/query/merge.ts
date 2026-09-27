import { isFileSearchBusinessField } from '../api/file-search-params'
import { isForbiddenFieldName } from './field-registry'
import type { FieldSource, ResolvedQuery } from './query-types'

/** 原网站页面上有，但不进入 GetSearchFiles。 */
const DISPLAY_ONLY_FIELDS = new Set(['selfilePath', 'filetemp', 'selfilename1', 'txtfilename1', 'tempName'])

function copyRecord(source: Record<string, string> | undefined, into: Record<string, string>, mark: Record<string, FieldSource>, sourceName: FieldSource, warnings: string[]): void {
  if (!source) return
  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || isForbiddenFieldName(key)) {
      warnings.push('已忽略不安全的覆盖字段。')
      continue
    }
    if (DISPLAY_ONLY_FIELDS.has(key)) continue
    if (!isFileSearchBusinessField(key) || typeof source[key] !== 'string') {
      warnings.push(`未注册字段 ${key} 不会进入查询请求。`)
      continue
    }
    Object.defineProperty(into, key, {
      value: source[key], enumerable: true, writable: true, configurable: true
    })
    Object.defineProperty(mark, key, {
      value: sourceName, enumerable: true, writable: true, configurable: true
    })
  }
}

/**
 * 临时覆盖 > 客户覆盖 > 基础模板。
 * 用字段是否存在判断覆盖；空字符串会清掉下层的值。
 * 不修改传入对象。
 */
export function resolveQueryTemplate(
  baseFields: Record<string, string> | undefined,
  customerOverrides: Record<string, string> | undefined,
  temporaryOverrides: Record<string, string> | undefined
): ResolvedQuery {
  const fields = Object.create(null) as Record<string, string>
  const sources = Object.create(null) as Record<string, FieldSource>
  const warnings: string[] = []
  copyRecord(baseFields, fields, sources, 'base', warnings)
  copyRecord(customerOverrides, fields, sources, 'customer', warnings)
  copyRecord(temporaryOverrides, fields, sources, 'temporary', warnings)
  return { fields, sources, warnings }
}
