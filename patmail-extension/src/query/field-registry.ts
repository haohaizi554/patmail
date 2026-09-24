import {
  isFileSearchBusinessField,
  type FileSearchRequestField
} from '../api/file-search-params'

/** QueryXml 节点名到 GetSearchFiles 参数名。来源：API/05 的 16 项改名。 */
export const XML_NODE_TO_API: Record<string, FileSearchRequestField> = {
  customername: 'customer',
  txtupdate_s: 'update_s',
  txtupdate_e: 'update_e',
  txtupdate_isnull: 'update_isnull',
  txtpost_s: 'post_s',
  txtpost_e: 'post_e',
  txtpost_isnull: 'post_isnull',
  selfileclass: 'fileclass',
  selfile_status: 'file_status',
  p_case_info__charge_dept_id: 'dept_id',
  business_type: 'business_type_id',
  column_1: 'column1',
  column_2: 'column2',
  column_3: 'column3',
  column_4: 'column4',
  column_5: 'column5'
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

export function isForbiddenFieldName(name: string): boolean {
  return FORBIDDEN.has(name)
}

export function xmlNodeToApiField(nodeName: string): FileSearchRequestField | null {
  if (isForbiddenFieldName(nodeName)) return null
  const renamed = XML_NODE_TO_API[nodeName]
  if (renamed) return renamed
  return isFileSearchBusinessField(nodeName) ? nodeName as FileSearchRequestField : null
}

export interface XmlNodeClass {
  kind: 'value' | 'display' | 'unknown'
  apiField?: FileSearchRequestField
}

/** `{id}_text` 是显示文本，不能当作请求参数。 */
export function classifyXmlNode(nodeName: string): XmlNodeClass {
  if (nodeName.endsWith('_text')) {
    const apiField = xmlNodeToApiField(nodeName.slice(0, -'_text'.length))
    return apiField ? { kind: 'display', apiField } : { kind: 'unknown' }
  }
  const apiField = xmlNodeToApiField(nodeName)
  return apiField ? { kind: 'value', apiField } : { kind: 'unknown' }
}

export const FIELD_LABELS: Record<string, string> = {
  case_type: '案件类型',
  filetype: '文件描述',
  customer_name_vague: '客户名称',
  case_volume: '我方文号',
  app_no: '申请号',
  file_name: '附件名称',
  fileclass: '文件来源',
  is_close: '是否包含结案',
  customer: '客户编号',
  file_status: '文件处理状态'
}

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name
}
