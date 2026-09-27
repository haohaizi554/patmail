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

/**
 * 页面上给人看的名称。来源是 FileSearch.aspx 的控件文字（API/05），
 * 日期一组在页面上共用一个标题，这里拆成起、止、为空。
 */
export const FIELD_LABELS: Record<string, string> = {
  customer: '客户',
  customer_name_vague: '客户名称',
  customer_code: '客户代码',
  customer_country: '客户国家(地区)',
  customer_status_id: '客户状态',
  customer_flow_user: '客户流程人员',
  case_type: '案件类型',
  case_volume: '我方文号',
  case_volume_customer: '客户文号',
  case_name: '案件名称',
  app_no: '申请号',
  apply_type: '申请类型',
  country: '申请国家(地区)',
  flow_direction: '案件流向',
  case_status: '案件状态',
  case_status_notequals: '案件状态不等于',
  is_close: '是否包含结案',
  applicant: '申请人',
  app_area_name: '第一申请人行政区划',
  inventor_name: '发明人',
  contact_name_zf: '专利负责人',
  apply_tags_id: '专利标签',
  case_remark: '案件备注',
  introducer: '外部案源人',
  issue_no: '注册号',
  pub_no: '登记号',
  branch_dept_id: '所属分部',
  dept_id: '承办部门',
  business_type_id: '业务类型',
  is_vip: '是否大客户',
  specialtyid: '专业领域',
  agency_id: '代理机构',
  filetype: '文件描述',
  file_name: '附件名称',
  file_name_batch: '附件名称（批量）',
  fileclass: '文件来源',
  file_status: '文件处理状态',
  file_remark: '文件备注',
  ofileType: '官方来文类型',
  receive_name: '领取人',
  i_ctrl_proc: '处理事项',
  proc_status: '处理事项状态',
  proc_remark: '处理事项备注',
  pic_user: '处理事项处理人',
  foreign_pic: '事项对外处理人',
  agency_user_id: '案件处理人',
  user_assistant: '案件处理人助理',
  sales: '业务员',
  sales_help: '业务助理',
  sale_dept_id: '业务员部门',
  upuser: '上传者',
  case_flow_user: '案件流程人员',
  revise_user_id: '核稿人',
  payment_review_user_id: '复核人',
  pat_production_user_id: '制作者',
  pat_patauditor_user_id: '审核者',
  pat_allocator_user_id: '分配者',
  update_s: '上传日期起',
  update_e: '上传日期止',
  update_isnull: '上传日期为空',
  post_s: '官方发文日起',
  post_e: '官方发文日止',
  post_isnull: '官方发文日为空',
  app_date_s: '申请日起',
  app_date_e: '申请日止',
  app_date_isnull: '申请日为空',
  proc_receipt_date_s: '事项收文日期起',
  proc_receipt_date_e: '事项收文日期止',
  proc_receipt_date_isnull: '事项收文日期为空',
  file_receipt_date_s: '文件收文日期起',
  file_receipt_date_e: '文件收文日期止',
  file_receipt_date_isnull: '文件收文日期为空',
  finish_date_s: '处理事项完成日起',
  finish_date_e: '处理事项完成日止',
  finish_date_isnull: '处理事项完成日为空',
  cus_receive_date_s: '客户领取日期起',
  cus_receive_date_e: '客户领取日期止',
  cus_receive_date_isnull: '客户领取日期为空',
  issue_date_s: '公告日起',
  issue_date_e: '公告日止',
  issue_date_isnull: '公告日为空',
  back_date_start: '返稿日起',
  back_date_end: '返稿日止',
  back_inventor_date_start: '返发明人日起',
  back_inventor_date_end: '返发明人日止',
  payment_review_time_s: '复核时间起',
  payment_review_time_e: '复核时间止',
  payment_review_time_isnull: '复核时间为空',
  update_production_user_time_s: '制作时间起',
  update_production_user_time_e: '制作时间止',
  update_production_user_time_isnull: '制作时间为空',
  update_patauditor_user_time_s: '审核时间起',
  update_patauditor_user_time_e: '审核时间止',
  update_patauditor_user_time_isnull: '审核时间为空',
  update_allocator_user_time_s: '分配时间起',
  update_allocator_user_time_e: '分配时间止',
  update_allocator_user_time_isnull: '分配时间为空',
  is_essence_exam: '同时提实审',
  is_confidential_request: '请求保密审查',
  is_ahead_pub: '提前公布',
  is_fee_reduce: '请求费用减缓',
  is_speed_checkd: '优先审查',
  is_request_das: '同时请求DAS码',
  hearing_the_case: '预审案件',
  is_examine_delay: '延迟审查',
  column1: '自定义栏位1',
  column2: '特批编号',
  column3: '回款日期',
  column4: '业务立案编号',
  column5: '所属部门'
}

const FIELD_GROUPS: Record<string, string> = {
  customer: '客户',
  customer_name_vague: '客户',
  customer_code: '客户',
  customer_country: '客户',
  customer_status_id: '客户',
  customer_flow_user: '客户',
  case_type: '案件',
  case_volume: '案件',
  case_volume_customer: '案件',
  case_name: '案件',
  app_no: '案件',
  apply_type: '案件',
  country: '案件',
  flow_direction: '案件',
  case_status: '案件',
  case_status_notequals: '案件',
  is_close: '案件',
  applicant: '案件',
  app_area_name: '案件',
  inventor_name: '案件',
  contact_name_zf: '案件',
  apply_tags_id: '案件',
  case_remark: '案件',
  introducer: '案件',
  issue_no: '案件',
  pub_no: '案件',
  branch_dept_id: '案件',
  dept_id: '案件',
  business_type_id: '案件',
  is_vip: '案件',
  specialtyid: '案件',
  agency_id: '案件',
  filetype: '文件',
  file_name: '文件',
  file_name_batch: '文件',
  fileclass: '文件',
  file_status: '文件',
  file_remark: '文件',
  ofileType: '文件',
  receive_name: '文件',
  i_ctrl_proc: '处理事项',
  proc_status: '处理事项',
  proc_remark: '处理事项',
  pic_user: '处理事项',
  foreign_pic: '处理事项',
  agency_user_id: '处理事项',
  user_assistant: '处理事项',
  sales: '人员',
  sales_help: '人员',
  sale_dept_id: '人员',
  upuser: '人员',
  case_flow_user: '人员',
  revise_user_id: '人员',
  payment_review_user_id: '人员',
  pat_production_user_id: '人员',
  pat_patauditor_user_id: '人员',
  pat_allocator_user_id: '人员',
  is_essence_exam: '其它',
  is_confidential_request: '其它',
  is_ahead_pub: '其它',
  is_fee_reduce: '其它',
  is_speed_checkd: '其它',
  is_request_das: '其它',
  hearing_the_case: '其它',
  is_examine_delay: '其它',
  column1: '自定义',
  column2: '自定义',
  column3: '自定义',
  column4: '自定义',
  column5: '自定义'
}

for (const name of Object.keys(FIELD_LABELS)) {
  if (name.endsWith('_s') || name.endsWith('_e') || name.endsWith('_isnull') || name.endsWith('_start') || name.endsWith('_end') || name.includes('_time_') || name.startsWith('back_')) {
    FIELD_GROUPS[name] = '日期'
  }
}

export function fieldGroup(name: string): string {
  return FIELD_GROUPS[name] ?? '其它'
}

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? '其他条件'
}
