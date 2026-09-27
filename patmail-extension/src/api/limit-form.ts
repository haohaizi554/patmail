import { apiError, type ApiResult } from './types'
import { isLimitMonitorInputField } from './limit-monitor-params'
import { MAX_QUERY_XML_CHARS, MAX_QUERY_XML_NODES } from '../query/xml-parser'

/** 期限监控「全部」页签的控件。来源：案件管理-期限监控 DOM，一排两个条件。 */

export interface LimitTextCell { kind: 'text'; key: string; label: string; checks?: { key: string; label: string }[] }
export interface LimitNamedCell { kind: 'named'; key: string; label: string }
export interface LimitSelectCell { kind: 'select'; key: string; label: string }
export interface LimitDateCell { kind: 'dates'; label: string; start: string; end: string; empty?: string }
export type LimitCell = LimitTextCell | LimitNamedCell | LimitSelectCell | LimitDateCell
export interface LimitBlock { title: string; more?: boolean; cells: LimitCell[] }

/** 页面控件 id 到 GetLimitMonitorCaseList 参数。同名的不用写。 */
export const LIMIT_XML_TO_FIELD: Record<string, string> = {
  case_volume_other: 'case_volume',
  app_no_other: 'app_no',
  applicant_other: 'applicant',
  flow_direction_other: 'flow_direction',
  p_case_info__charge_dept_id: 'dept_id',
  int_due_date_other_isnull: 'int_due_date_isnull',
  cus_due_date_other_isnull: 'cus_due_date_isnull',
  legal_due_date_other_isnull: 'legal_due_date_isnull',
  branch_dept_id2: 'branch_dept',
  customer_codes: 'customer_code',
  customer_status: 'customer_status_id',
  case_status: 'case_status_id',
  app_date_from2: 'app_date_from',
  app_date_to2: 'app_date_to',
  app_date_isnull2: 'app_date_isnull',
  proc_pic_user_other: 'proc_pic_user',
  other_proc_status: 'proc_status',
  doc_date_other_isnull: 'doc_date_isnull',
  p_case_info_flow_user_id: 'flow_user_id',
  apply_tags_id_other: 'apply_tags_id',
  case_volume_customer_all: 'case_volume_customer'
}

/** 期限控件对应文件查询页已经扫下来的选项。接口还没返回时用这份，避免下拉被清空。 */
export const LIMIT_OPTION_KEYS: Record<string, string> = {
  country: 'country',
  business_type_other: 'business_type_id',
  dept_id: 'dept_id',
  apply_subject: 'apply_type',
  branch_dept: 'branch_dept_id',
  customer_country: 'customer_country',
  other_agency_id: 'agency_id',
  customer_status_id: 'customer_status_id',
  case_status_id: 'case_status',
  ctrl_proc: 'i_ctrl_proc',
  proc_pic_user: 'pic_user',
  case_pic_user: 'foreign_pic',
  proc_status: 'proc_status',
  revise_user_id: 'revise_user_id',
  sales: 'sales',
  sales_help: 'sales_help',
  flow_user_id: 'sales',
  apply_tags_id: 'apply_tags_id',
  pic_dept_id: 'dept_id',
  user_assistant: 'user_assistant'
}

export const LIMIT_SELECTS: Record<string, { value: string; label: string }[]> = {
  case_type: [
    { value: '31D1A147-2931-43B5-94AE-B72B1525BA8A', label: '专利' },
    { value: '0E8A4B7F-E407-4EFF-9562-3809BF484207', label: '商标' },
    { value: 'ABD40742-04F9-455F-BC41-080E9D896F80', label: '版权/综合' },
    { value: '122136EA-F3E3-46C5-A529-EFC358AC764B', label: '其他' },
    { value: '882D9F78-7656-468E-BE98-68FE5E334A9B', label: '科技服务' },
    { value: '7A74BEB6-13DE-444B-892F-6E339D4067A2', label: '法律案件' },
    { value: '849F2D30-DDAA-4718-AD1E-1951DE67913D', label: '调查案' }
  ],
  flow_direction: [
    { value: 'II', label: '内-内' },
    { value: 'IO', label: '内-外' },
    { value: 'OI', label: '外-内' },
    { value: 'OO', label: '外-外' }
  ],
  proc_type: [
    { value: 'A72068F7-6520-4AAF-A026-DADEB792ED4E', label: '官方事项' },
    { value: '5FCD8B49-7BA8-4F42-AB1B-A0E7E75CB7FB', label: '内部事项' }
  ]
}

const dates = (label: string, start: string, end: string, empty?: string): LimitDateCell => ({ kind: 'dates', label, start, end, empty })

export const LIMIT_BLOCKS: LimitBlock[] = [
  {
    title: '期限条件',
    cells: [
      { kind: 'text', key: 'case_volume', label: '我方文号', checks: [{ key: 'is_fuzzy_query_case_volume_other', label: '是否模糊查询' }] },
      { kind: 'text', key: 'app_no', label: '申请号', checks: [{ key: 'is_fuzzy_query_app_no_other', label: '是否模糊查询' }, { key: 'is_point_app_no_other', label: '去点查询' }] },
      { kind: 'select', key: 'case_type', label: '案件类型' },
      { kind: 'named', key: 'country', label: '申请国家(地区)' },
      { kind: 'text', key: 'applicant', label: '申请人' },
      { kind: 'named', key: 'business_type_other', label: '业务类型' },
      { kind: 'select', key: 'flow_direction', label: '案件流向' },
      { kind: 'named', key: 'dept_id', label: '承办部门' },
      dates('最早期限', 'smallduc_date_from', 'smallduc_date_to', 'smallduc_date_isnull'),
      dates('内部期限', 'int_due_date_s', 'int_due_date_e', 'int_due_date_isnull'),
      dates('客户期限', 'cus_due_date_s', 'cus_due_date_e', 'cus_due_date_isnull'),
      dates('官方期限', 'legal_due_date_s', 'legal_due_date_e', 'legal_due_date_isnull'),
      { kind: 'named', key: 'apply_subject', label: '申请类型' },
      { kind: 'named', key: 'branch_dept', label: '所属分部' },
      { kind: 'text', key: 'customer_name', label: '客户名称' },
      { kind: 'text', key: 'customer_code', label: '客户代码' },
      { kind: 'named', key: 'customer_country', label: '客户国家(地区)' },
      { kind: 'named', key: 'other_agency_id', label: '代理机构' },
      { kind: 'named', key: 'customer_status_id', label: '客户状态' },
      { kind: 'named', key: 'case_status_id', label: '案件状态' },
      dates('申请日', 'app_date_from', 'app_date_to', 'app_date_isnull'),
      dates('申请日(月日)', 'month_day_from', 'month_day_to'),
      { kind: 'select', key: 'proc_type', label: '事项类型' },
      { kind: 'named', key: 'ctrl_proc', label: '处理事项' },
      { kind: 'text', key: 'introducer', label: '外部案源人' },
      { kind: 'named', key: 'proc_pic_user', label: '处理事项处理人' },
      dates('返稿日', 'back_date_start', 'back_date_end'),
      { kind: 'named', key: 'case_pic_user', label: '案件对外处理人' },
      { kind: 'text', key: 'inventor', label: '发明人' },
      dates('处理事项创建日', 'create_proc_date_start', 'create_proc_date_end'),
      { kind: 'named', key: 'proc_status', label: '处理事项状态' },
      dates('返发明人日', 'back_inventor_date_start', 'back_inventor_date_end'),
      { kind: 'named', key: 'revise_user_id', label: '核稿人' },
      dates('官方发文日', 'doc_date_s', 'doc_date_e', 'doc_date_isnull'),
      { kind: 'named', key: 'sales', label: '业务人员' }
    ]
  },
  {
    title: '更多期限条件',
    more: true,
    cells: [
      { kind: 'named', key: 'sales_help', label: '业务助理' },
      { kind: 'named', key: 'flow_user_id', label: '流程人员' },
      dates('委案日期', 'charge_date_from', 'charge_date_end'),
      { kind: 'text', key: 'proc_note', label: '处理事项备注' },
      { kind: 'named', key: 'apply_tags_id', label: '专利标签' },
      { kind: 'named', key: 'pic_dept_id', label: '处理人部门' },
      { kind: 'text', key: 'case_volume_customer', label: '客户文号' },
      { kind: 'named', key: 'user_assistant', label: '案件处理人助理' },
      dates('文件上传日期', 'upload_date_from', 'upload_date_end'),
      dates('代理人回复日', 'agent_to_reply_start', 'agent_to_reply_end'),
      dates('回复代理人日', 'reply_to_agent_start', 'reply_to_agent_end'),
      dates('提醒代理人日', 'remind_to_agent_start', 'remind_to_agent_end'),
      dates('最终绝限日', 'last_deli_deadline_start', 'last_deli_deadline_end'),
      dates('书面绝限日', 'book_deli_deadline_start', 'book_deli_deadline_end'),
      dates('回复客户日', 'reply_cus_date_start', 'reply_cus_date_end'),
      dates('客户确收日', 'cus_receipt_start', 'cus_receipt_end'),
      dates('客户回复日', 'finish_revise_date_start', 'finish_revise_date_end'),
      dates('客户委托日', 'cus_entrust_start', 'cus_entrust_end'),
      dates('提示客户日', 'prompt_cus_start', 'prompt_cus_end'),
      dates('回复外所日', 'reply_agengcy_start', 'reply_agengcy_end'),
      dates('外所确收日', 'agengcy_receipt_start', 'agengcy_receipt_end'),
      dates('外所回复日', 'agengcy_revise_start', 'agengcy_revise_end'),
      dates('提示外所日', 'prompt_agengcy_start', 'prompt_agengcy_end'),
      dates('第三方回复日', 'third_party_revise_start', 'third_party_revise_end'),
      dates('回复第三方日', 'revise_third_party_start', 'revise_third_party_end'),
      dates('第三方确收日', 'receipt_third_party_start', 'receipt_third_party_end'),
      { kind: 'text', key: 'pat_cus_fullname', label: '客户全称' },
      { kind: 'text', key: 'column1', label: '自定义栏位1' },
      { kind: 'text', key: 'column2', label: '特批编号' },
      { kind: 'text', key: 'column3', label: '回款日期' },
      { kind: 'text', key: 'column4', label: '业务立案编号' },
      { kind: 'text', key: 'column5', label: '所属部门' }
    ]
  }
]

const DISPLAY_ONLY = new Set(['business_type_other'])

function limitField(nodeName: string): string | null {
  if (DISPLAY_ONLY.has(nodeName)) return nodeName
  const mapped = LIMIT_XML_TO_FIELD[nodeName] ?? nodeName
  return isLimitMonitorInputField(mapped) ? mapped : null
}

export function readLimitQueryXml(xml: string): ApiResult<Record<string, string>> {
  if (typeof xml !== 'string' || !xml.trim()) return apiError('INVALID_RESPONSE', '期限模板为空。')
  if (xml.length > MAX_QUERY_XML_CHARS) return apiError('INVALID_RESPONSE', '期限模板超出大小限制。')
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(xml)) return apiError('INVALID_RESPONSE', '期限模板包含不允许的文档类型声明。')
  if (typeof DOMParser === 'undefined') return apiError('INVALID_RESPONSE', '当前环境无法解析期限模板。')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) return apiError('INVALID_RESPONSE', '期限模板无法解析。')
  const root = document.documentElement
  if (!root || root.nodeName !== 'xmlRoot') return apiError('INVALID_RESPONSE', '期限模板缺少 xmlRoot。')
  const nodes = Array.from(root.children)
  if (nodes.length > MAX_QUERY_XML_NODES) return apiError('INVALID_RESPONSE', '期限模板节点过多。')
  const fields: Record<string, string> = {}
  for (const node of nodes) {
    const key = limitField(node.nodeName)
    if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    fields[key] = node.textContent ?? ''
  }
  return { ok: true, data: fields }
}
