import { CURRENT_ENVIRONMENT } from './config'
import { apiError, type ApiResult } from './types'

/** 页签共用 GetLimitMonitorCaseList，只改 type。流程页签是另一个 Call，字段还没核对。 */
export const LIMIT_MONITOR_TYPES = ['all', 'pay', 'suspend', 'abandon', 'recall', 'priority', 'fee'] as const

export type LimitMonitorType = (typeof LIMIT_MONITOR_TYPES)[number]

export interface LimitMonitorQuery {
  type: LimitMonitorType
  caseVolume?: string
  applicationNo?: string
  customerName?: string
  ctrlProcId?: string
  /** 期限监控表单里已填写的条件。只接收 115 项里的业务字段。 */
  fields?: Record<string, string>
  pageIndex: number
  pageSize: number
}

const LIMIT_MONITOR_LOCKED = new Set<string>([
  'pageIndex', 'pageSize', 'select_and', 'Call', 'is_first', 'type', 'colsel', '_t', 'log_pagename'
])

export function isLimitMonitorInputField(name: string): boolean {
  return (LIMIT_MONITOR_FIELDS as readonly string[]).includes(name) && !LIMIT_MONITOR_LOCKED.has(name)
}

/**
 * API/09-期限监控.md 的 115 项顺序。未使用的条件传空字符串。
 * 原网站还会多交 business_type_other。type=flow 不在这里，那个请求会改成 FlowMonitorInfo。
 */
export const LIMIT_MONITOR_FIELDS = [
  'pageIndex', 'pageSize', 'select_and', 'Call', 'is_first', 'case_type', 'country',
  'case_volume', 'case_volume_customer', 'is_fuzzy_query_case_volume_other',
  'is_fuzzy_query_app_no_other', 'is_point_app_no_other', 'applicant', 'app_no',
  'int_due_date_s', 'int_due_date_e', 'legal_due_date_s', 'legal_due_date_e',
  'cus_due_date_s', 'cus_due_date_e', 'int_due_date_isnull', 'NKG_date',
  'legal_due_date_isnull', 'ctrl_proc', 'customer_name', 'customer_code', 'introducer',
  'doc_date_s', 'doc_date_e', 'charge_date_from', 'charge_date_end', 'doc_date_isnull',
  'smallduc_date_from', 'smallduc_date_to', 'smallduc_date_isnull', 'cus_due_date_isnull',
  'type', 'apply_subject', 'inventor', 'flow_direction', 'proc_pic_user', 'case_pic_user',
  'branch_dept', 'app_date_from', 'app_date_to', 'app_date_isnull', 'month_day_from',
  'month_day_to', 'case_status_id', 'dept_id', 'back_date_start', 'back_date_end',
  'back_inventor_date_start', 'back_inventor_date_end', 'customer_status_id',
  'revise_user_id', 'proc_type', 'proc_note', 'sales', 'sales_help', 'flow_user_id',
  'create_proc_date_start', 'create_proc_date_end', 'other_agency_id', 'customer_country',
  'proc_status', 'apply_tags_id', 'is_finishdate', 'upload_date_from', 'upload_date_end',
  'pic_dept_id', 'user_assistant', 'pat_cus_fullname', 'agent_to_reply_start',
  'reply_to_agent_start', 'remind_to_agent_start', 'last_deli_deadline_start',
  'book_deli_deadline_start', 'reply_cus_date_start', 'cus_receipt_start',
  'finish_revise_date_start', 'cus_entrust_start', 'prompt_cus_start', 'reply_agengcy_start',
  'agengcy_receipt_start', 'agengcy_revise_start', 'prompt_agengcy_start',
  'third_party_revise_start', 'revise_third_party_start', 'receipt_third_party_start',
  'agent_to_reply_end', 'reply_to_agent_end', 'remind_to_agent_end', 'last_deli_deadline_end',
  'book_deli_deadline_end', 'reply_cus_date_end', 'cus_receipt_end', 'finish_revise_date_end',
  'cus_entrust_end', 'prompt_cus_end', 'reply_agengcy_end', 'agengcy_receipt_end',
  'agengcy_revise_end', 'prompt_agengcy_end', 'third_party_revise_end',
  'revise_third_party_end', 'receipt_third_party_end', 'column1', 'column2', 'column3',
  'column4', 'column5', 'business_type_other', 'colsel', '_t', 'log_pagename'
] as const

export const LIMIT_MONITOR_COLSEL = ';undefined;undefined;case_id;case_volume;case_name;ctrl_proc;pic;review_stage;doc_date;int_due_date;smallduc_date;cus_due_date;legal_due_date;foreign_pic_case;customer_name;customer_status;revise_user;case_mail_date;'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLimitMonitorType(value: string): value is LimitMonitorType {
  return (LIMIT_MONITOR_TYPES as readonly string[]).includes(value)
}

export function buildLimitMonitorParams(
  query: LimitMonitorQuery,
  now: () => number = Date.now
): ApiResult<URLSearchParams> {
  if (!isLimitMonitorType(query.type)) return apiError('INVALID_QUERY', '期限监控页签无效。')
  if (!Number.isSafeInteger(query.pageIndex) || query.pageIndex < 1 ||
      !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    return apiError('INVALID_QUERY', '页码或每页数量无效。')
  }
  const caseVolume = query.caseVolume?.trim() ?? ''
  const applicationNo = query.applicationNo?.trim().replace(/\./g, '') ?? ''
  const customerName = query.customerName?.trim() ?? ''
  const ctrlProcId = query.ctrlProcId?.trim() ?? ''
  const fields = query.fields ?? {}
  for (const [key, value] of Object.entries(fields)) {
    if (!isLimitMonitorInputField(key) || typeof value !== 'string') {
      return apiError('INVALID_QUERY', '期限条件里有不能提交的项目。')
    }
  }
  const filled = [caseVolume, applicationNo, customerName, ctrlProcId, ...Object.values(fields)].some(value => value.trim())
  if (!filled) return apiError('INVALID_QUERY', '请输入我方文号、申请号、客户或处理事项。')
  if ((ctrlProcId && !GUID.test(ctrlProcId)) || (fields.ctrl_proc?.trim() && !GUID.test(fields.ctrl_proc.trim()))) {
    return apiError('INVALID_QUERY', '处理事项必须使用内部 ID。')
  }
  const values: Record<string, string> = {}
  for (const field of LIMIT_MONITOR_FIELDS) values[field] = ''
  for (const [key, value] of Object.entries(fields)) values[key] = value.trim()
  Object.assign(values, {
    pageIndex: String(query.pageIndex),
    pageSize: String(query.pageSize),
    select_and: 'false',
    Call: 'GetLimitMonitorCaseList',
    is_first: 'false',
    case_type: values.case_type || CURRENT_ENVIRONMENT.caseTypeId,
    case_volume: caseVolume || values.case_volume,
    is_fuzzy_query_case_volume_other: values.is_fuzzy_query_case_volume_other || 'false',
    is_fuzzy_query_app_no_other: values.is_fuzzy_query_app_no_other || 'false',
    is_point_app_no_other: values.is_point_app_no_other || 'false',
    app_no: applicationNo || values.app_no,
    ctrl_proc: ctrlProcId || values.ctrl_proc,
    customer_name: customerName || values.customer_name,
    type: query.type,
    colsel: LIMIT_MONITOR_COLSEL,
    _t: String(now()),
    log_pagename: 'LimitMonitor.aspx'
  })
  const params = new URLSearchParams()
  for (const field of LIMIT_MONITOR_FIELDS) params.append(field, values[field] ?? '')
  return { ok: true, data: params }
}

/** 单个处理事项创建发文。多个 ID 的分隔符抓包没出现，这里不猜测。写开关关闭时调用方不得发送。 */
export function buildLimitMailCustomerParams(input: { procId: string; mailTypeId: string; mailStyle?: string }): ApiResult<URLSearchParams> {
  const procId = input.procId.trim()
  const mailTypeId = input.mailTypeId.trim()
  const mailStyle = input.mailStyle ?? '1'
  if (!GUID.test(procId)) return apiError('INVALID_QUERY', '处理事项必须使用内部 ID。')
  if (!GUID.test(mailTypeId)) return apiError('INVALID_QUERY', '发文类型必须使用内部 ID。')
  if (!/^[1-6]$/.test(mailStyle)) return apiError('INVALID_QUERY', '发文合并方式无效。')
  const params = new URLSearchParams()
  params.set('Call', 'LimitMailCustomer')
  params.set('_file_ids', procId)
  params.set('mailstyle', mailStyle)
  params.set('mailtype', mailTypeId)
  params.set('log_pagename', 'LimitMonitor.aspx')
  return { ok: true, data: params }
}
