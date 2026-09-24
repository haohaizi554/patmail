import { CURRENT_ENVIRONMENT } from './config'
import { apiError, type ApiResult } from './types'

export interface FileSearchQuery {
  caseVolume?: string
  applicationNo?: string
  customerName?: string
  fileName?: string
  fileDescriptionId?: string
  pageIndex: number
  pageSize: number
}

export interface FileSearchEnvironment {
  fileClass: string
  caseTypeId: string
  isPatent: number
  colsel: string
}

/**
 * API/04-文件查询.md 的 117 项顺序。_doneCallback 是旧前端回调序列化产物，
 * 不参与独立业务请求，因此实际提交 116 项。
 */
const DOCUMENTED_FIELDS = [
  'pageIndex', 'pageSize', 'Call', 'customer', 'filetype', 'update_s', 'update_e',
  'update_isnull', 'post_s', 'post_e', 'post_isnull', 'case_volume', 'fileclass',
  'applicant', 'case_volume_customer', 'app_no', 'flow_direction', 'sales', 'upuser',
  'file_status', 'app_date_s', 'app_date_e', 'app_date_isnull', 'proc_receipt_date_s',
  'proc_receipt_date_e', 'proc_receipt_date_isnull', 'file_receipt_date_s',
  'file_receipt_date_e', 'file_receipt_date_isnull', 'is_close', 'apply_type',
  'country', 'i_ctrl_proc', 'agency_id', 'proc_status', 'finish_date_s', 'finish_date_e',
  'finish_date_isnull', 'case_type', 'file_name', 'file_name_batch', 'branch_dept_id',
  'customer_name_vague', 'app_area_name', 'customer_flow_user', 'case_flow_user',
  'sales_help', 'introducer', 'customer_code', 'dept_id', 'sale_dept_id',
  'agency_user_id', 'business_type_id', 'user_assistant', 'receive_name',
  'cus_receive_date_s', 'cus_receive_date_e', 'cus_receive_date_isnull', 'issue_no',
  'pub_no', 'issue_date_s', 'issue_date_e', 'issue_date_isnull', 'back_date_start',
  'back_date_end', 'back_inventor_date_start', 'back_inventor_date_end',
  'customer_status_id', 'revise_user_id', 'ofileType', 'is_essence_exam',
  'is_confidential_request', 'is_ahead_pub', 'is_fee_reduce', 'is_speed_checkd',
  'is_request_das', 'hearing_the_case', 'is_examine_delay', 'customer_country',
  'case_remark', 'pic_user', 'foreign_pic', 'case_status', 'case_name',
  'case_status_notequals', 'apply_tags_id', 'proc_remark', 'payment_review_user_id',
  'payment_review_time_s', 'payment_review_time_e', 'payment_review_time_isnull',
  'pat_production_user_id', 'update_production_user_time_s',
  'update_production_user_time_e', 'update_production_user_time_isnull',
  'pat_patauditor_user_id', 'update_patauditor_user_time_s',
  'update_patauditor_user_time_e', 'update_patauditor_user_time_isnull',
  'pat_allocator_user_id', 'update_allocator_user_time_s', 'update_allocator_user_time_e',
  'file_remark', 'update_allocator_user_time_isnull', 'column1', 'column2', 'column3',
  'column4', 'column5', 'inventor_name', 'contact_name_zf', 'IsFirst', 'is_pat',
  'colsel', '_t', 'log_pagename'
] as const

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validInternalIds(value: string): boolean {
  return value.split(',').every(id => GUID.test(id.trim()))
}

export function buildGetSearchFilesParams(
  query: FileSearchQuery,
  environment: FileSearchEnvironment = CURRENT_ENVIRONMENT,
  now: () => number = Date.now
): ApiResult<URLSearchParams> {
  if (!Number.isSafeInteger(query.pageIndex) || query.pageIndex < 1 ||
      !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    return apiError('INVALID_QUERY', '页码或每页数量无效。')
  }
  const caseVolume = query.caseVolume?.trim() ?? ''
  const applicationNo = query.applicationNo?.trim().replace(/\./g, '') ?? ''
  const customerName = query.customerName?.trim() ?? ''
  const fileName = query.fileName?.trim() ?? ''
  const fileDescriptionId = query.fileDescriptionId?.trim() ?? ''
  if (![caseVolume, applicationNo, customerName, fileName, fileDescriptionId].some(Boolean)) {
    return apiError('INVALID_QUERY', '请输入查询条件。')
  }
  if (fileDescriptionId && !validInternalIds(fileDescriptionId)) {
    return apiError('INVALID_QUERY', '文件描述必须使用内部 ID。')
  }
  const values: Record<string, string> = {
    pageIndex: String(query.pageIndex),
    pageSize: String(query.pageSize),
    Call: 'GetSearchFiles',
    case_volume: caseVolume,
    app_no: applicationNo,
    customer_name_vague: customerName,
    file_name: fileName,
    filetype: fileDescriptionId,
    fileclass: environment.fileClass,
    case_type: environment.caseTypeId,
    IsFirst: 'false',
    is_pat: String(environment.isPatent),
    colsel: environment.colsel,
    _t: String(now()),
    log_pagename: 'FileSearch.aspx'
  }
  const params = new URLSearchParams()
  for (const field of DOCUMENTED_FIELDS) params.append(field, values[field] ?? '')
  return { ok: true, data: params }
}
