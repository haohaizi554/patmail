import { isFileSearchBusinessField } from '../api/file-search-params'
import { apiFieldToXmlNode } from './field-registry'

const NODE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function pushNode(parts: string[], used: Set<string>, name: string, value: string): void {
  const text = value.trim()
  if (!text || !NODE_NAME.test(name) || used.has(name)) return
  used.add(name)
  parts.push(`<${name}>${escapeXml(text)}</${name}>`)
}

/** 按原网站历史模板的写法组 XML：控件 id 作节点名，树形框另写 `_text`。空值不写入。 */
export function buildQueryXml(
  fields: Record<string, string>,
  displayValues: Record<string, string> = {},
  unknownFields: Record<string, string> = {}
): string {
  const parts: string[] = []
  const used = new Set<string>()
  for (const key of Object.keys(fields).sort()) {
    if (!isFileSearchBusinessField(key)) continue
    const node = apiFieldToXmlNode(key)
    pushNode(parts, used, node, fields[key] ?? '')
    const label = displayValues[key]?.trim() ?? ''
    if (label && label !== (fields[key] ?? '').trim()) pushNode(parts, used, `${node}_text`, label)
  }
  for (const key of Object.keys(unknownFields).sort()) {
    pushNode(parts, used, key, unknownFields[key] ?? '')
  }
  return `<xmlRoot>${parts.join('')}</xmlRoot>`
}
