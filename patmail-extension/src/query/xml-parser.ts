import { apiError, type ApiResult } from '../api/types'
import { classifyXmlNode, isForbiddenFieldName } from './field-registry'
import type { ParsedQueryXml } from './query-types'

export const MAX_QUERY_XML_CHARS = 200_000
export const MAX_QUERY_XML_NODES = 500

function emptyRecord(): Record<string, string> {
  return Object.create(null) as Record<string, string>
}

function assign(target: Record<string, string>, key: string, value: string): boolean {
  if (isForbiddenFieldName(key)) return false
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  return true
}

export function parseQueryXml(xml: string, sourceName = '历史模板'): ApiResult<ParsedQueryXml> {
  if (typeof xml !== 'string' || !xml.trim()) {
    return apiError('INVALID_RESPONSE', '历史模板 XML 为空。')
  }
  if (xml.length > MAX_QUERY_XML_CHARS) {
    return apiError('INVALID_RESPONSE', '历史模板 XML 超出大小限制。')
  }
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(xml)) {
    return apiError('INVALID_RESPONSE', '历史模板 XML 包含不允许的文档类型声明。')
  }
  if (typeof DOMParser === 'undefined') {
    return apiError('INVALID_RESPONSE', '当前环境无法解析历史模板 XML。')
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    return apiError('INVALID_RESPONSE', '历史模板 XML 无法解析。')
  }
  const root = document.documentElement
  if (!root || root.nodeName !== 'xmlRoot') {
    return apiError('INVALID_RESPONSE', '历史模板 XML 缺少 xmlRoot。')
  }
  const nodes = Array.from(root.children)
  if (nodes.length > MAX_QUERY_XML_NODES) {
    return apiError('INVALID_RESPONSE', '历史模板 XML 节点过多。')
  }
  const fields = emptyRecord()
  const displayValues = emptyRecord()
  const unknownFields = emptyRecord()
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const name = node.nodeName
    if (isForbiddenFieldName(name)) {
      warnings.push(`${sourceName} 忽略了不安全字段名。`)
      continue
    }
    const value = node.textContent ?? ''
    const classified = classifyXmlNode(name)
    if (classified.kind === 'unknown' || !classified.apiField) {
      if (assign(unknownFields, name, value)) {
        warnings.push(`${sourceName} 含有未注册字段 ${name}。`)
      }
      continue
    }
    const target = classified.kind === 'display' ? displayValues : fields
    if (classified.kind === 'value' && seen.has(classified.apiField)) {
      warnings.push(`${sourceName} 的字段 ${classified.apiField} 重复，采用最后一个值。`)
    }
    if (classified.kind === 'value') seen.add(classified.apiField)
    assign(target, classified.apiField, value)
  }
  return { ok: true, data: { fields, displayValues, unknownFields, warnings } }
}
