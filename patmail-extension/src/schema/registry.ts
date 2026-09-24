import type { BusinessFieldSchema } from './types'

/** 文件查询表单只描述这里登记的字段，控件类型不在每个页面里各写一份。 */
export const FILE_SEARCH_SCHEMA: BusinessFieldSchema[] = [
  { key: 'case_type', label: '案件类型', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'caseType', enabled: true },
  { key: 'filetype', label: '文件描述', controlType: 'tree', valueType: 'internal-id', source: 'api', dictionaryKey: 'fileType', enabled: true, dependsOn: ['case_type'] },
  { key: 'file_status', label: '文件状态', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'fileStatus', enabled: true },
  { key: 'customer_name_vague', label: '客户名称', controlType: 'text', valueType: 'text', source: 'history', enabled: true },
  { key: 'case_volume', label: '我方文号', controlType: 'text', valueType: 'text', source: 'history', enabled: true },
  { key: 'post_s', label: '官方发文日', controlType: 'date-range', valueType: 'date', source: 'history', enabled: true, endKey: 'post_e' },
  { key: 'app_no', label: '申请号', controlType: 'text', valueType: 'text', source: 'history', enabled: true, advanced: true },
  { key: 'file_name', label: '附件名称', controlType: 'text', valueType: 'text', source: 'history', enabled: true },
  { key: 'fileclass', label: '文件来源', controlType: 'select', valueType: 'internal-id', source: 'local', dictionaryKey: 'fileclass', enabled: true, advanced: true },
  { key: 'country', label: '申请国家(地区)', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'country', enabled: true, advanced: true },
  { key: 'apply_type', label: '申请类型', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'applyType', enabled: true, dependsOn: ['case_type'], advanced: true },
  { key: 'business_type_id', label: '业务类型', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'bussType', enabled: true, dependsOn: ['case_type'], advanced: true },
  { key: 'case_status', label: '案件状态', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'caseStatus', enabled: true, dependsOn: ['case_type'], advanced: true },
  { key: 'proc_status', label: '处理状态', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'procStatus', enabled: true, advanced: true },
  { key: 'flow_direction', label: '案件流向', controlType: 'select', valueType: 'internal-id', source: 'api', dictionaryKey: 'caseDirection', enabled: true, advanced: true },
  { key: 'is_close', label: '包含结案', controlType: 'checkbox', valueType: 'boolean-string', source: 'history', enabled: true, advanced: true }
]

export function schemaField(key: string): BusinessFieldSchema | undefined {
  return FILE_SEARCH_SCHEMA.find(field => field.key === key || field.endKey === key)
}
