import { apiError, type ApiResult } from '../api/types'
import { isRecord } from '../api/response-guards'
import { isQueryGuid } from '../query/query-validator'

/** 客户名单下拉只留编号和名称。电话、邮箱和人员不进入插件。 */
export interface EasyCustomerOption {
  id: string
  name: string
}

const NAME_LIMIT = 200

/** 与客户列表页一次取全量的请求一致。空筛选项保持页面默认值。 */
export function customerListParams(): URLSearchParams {
  const params = new URLSearchParams()
  params.set('Call', 'GetCustomerlist')
  params.set('pageIndex', '1')
  params.set('pageSize', '9000000')
  params.set('pageIsFirstRequest', 'false')
  params.set('customer_name', '')
  params.set('customer_name_islike', '0')
  params.set('customer_code', '')
  params.set('customerfrom', '')
  params.set('customerfrom2', '')
  params.set('customerfrom_isnull', '0')
  params.set('customerfrom_isnull2', '0')
  params.set('head_user', '')
  params.set('head_user_isnull', '0')
  params.set('credit', '')
  params.set('customertype', '')
  params.set('case_type', '')
  params.set('customer_corporation', '')
  params.set('startday', '')
  params.set('endday', '')
  params.set('applicant', '')
  params.set('other_Condition', '')
  params.set('is_conclude', '10')
  params.set('customer_contact', '')
  params.set('introducer', '')
  params.set('inside_introducer', '')
  params.set('customertown', '')
  params.set('customerpark', '')
  params.set('searchrole', '1')
  params.set('teamwork_help_user', '')
  params.set('business_coop', '')
  params.set('pat_cus_fullname', '')
  params.set('industry_cls', '')
  params.set('country_id', '')
  params.set('country_id_isnull', '0')
  params.set('customer_country_id_two', '')
  params.set('customer_country_id_two_isnull', '0')
  params.set('start_cus_use_date', '')
  params.set('end_cus_use_date', '')
  params.set('city', '')
  params.set('customerbuss', '')
  params.set('sourcetype', '')
  params.set('create_user_id', '')
  params.set('interval_day', '')
  params.set('nickname', '')
  params.set('customer_no', '')
  params.set('customer_template', '')
  params.set('foreign_pic_user_id', '')
  params.set('flow_user', '')
  params.set('customer_class', '')
  params.set('remark', '')
  params.set('sales_help', '')
  params.set('branch_dept_id', '')
  params.set('is_vip', '10')
  params.set('bill_title', '')
  params.set('bill_title_isnull', '0')
  params.set('invoice_title', '')
  params.set('invoice_title_isnull', '0')
  params.set('colsel', ';undefined;undefined;customer_name;head_user;create_time;is_concluded;tel;email;contact_name;rate_list;')
  params.set('log_pagename', 'customerlist.aspx')
  return params
}

/** 从 GetCustomerlist 的 TableRows 取出客户。同一编号只留第一次出现的名称。 */
export function readCustomerList(data: Record<string, unknown>): ApiResult<EasyCustomerOption[]> {
  const rows = data.TableRows
  if (rows === null) return { ok: true, data: [] }
  if (!Array.isArray(rows)) return apiError('INVALID_RESPONSE', '客户列表响应缺少 TableRows。')
  const customers: EasyCustomerOption[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = typeof row.customer_id === 'string' ? row.customer_id.trim() : ''
    const name = typeof row.customer_name === 'string' ? row.customer_name.trim() : ''
    if (!isQueryGuid(id) || !name || name.length > NAME_LIMIT) continue
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    customers.push({ id, name })
  }
  return { ok: true, data: customers }
}
