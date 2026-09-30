/** 文件查询页的排版。来源：客户管理-文件管理 DOM，一排三个条件。 */

export interface TextCell { kind: 'text'; key: string; label: string }
export interface NamedCell { kind: 'named'; key: string; label: string }
export interface SelectCell { kind: 'select'; key: string; label: string }
export interface DateCell { kind: 'dates'; label: string; start: string; end: string; empty?: string }
export interface CheckCell { kind: 'checks'; label: string; items: { key: string; label: string }[] }
export interface FileCell { kind: 'files'; key: string; label: string }
export interface DownloadNameCell { kind: 'download-name' }
export type QueryCell = TextCell | NamedCell | SelectCell | DateCell | CheckCell | FileCell | DownloadNameCell

export interface QueryBlock {
  title: string
  cells: QueryCell[]
  more?: boolean
}

export interface QuerySection {
  title: string
  cells: QueryCell[]
  extra: QueryCell[]
}

export const PAGE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  case_type: [
    { value: '31D1A147-2931-43B5-94AE-B72B1525BA8A', label: '专利' },
    { value: '0E8A4B7F-E407-4EFF-9562-3809BF484207', label: '商标' },
    { value: 'ABD40742-04F9-455F-BC41-080E9D896F80', label: '版权/综合' },
    { value: '122136EA-F3E3-46C5-A529-EFC358AC764B', label: '其他' },
    { value: '882D9F78-7656-468E-BE98-68FE5E334A9B', label: '科技服务' },
    { value: '7A74BEB6-13DE-444B-892F-6E339D4067A2', label: '法律案件' },
    { value: '849F2D30-DDAA-4718-AD1E-1951DE67913D', label: '调查案' }
  ],
  is_close: [
    { value: '', label: '是' },
    { value: '1', label: '否' }
  ],
  file_status: [
    { value: 'UN', label: '未处理' },
    { value: 'IN', label: '处理中' },
    { value: 'FN', label: '已登回执' },
    { value: 'SN', label: '已完成' }
  ],
  ofileType: [
    { value: 'ALL_file', label: '全部官方来文' },
    { value: 'CN_file', label: '中国官方来文' },
    { value: 'US_file', label: '美国官方来文' },
    { value: 'PCT_file', label: 'PCT官方来文' },
    { value: 'OTHER_file', label: '其他官方来文' }
  ],
  is_vip: [
    { value: '0', label: '否' },
    { value: '1', label: '是' }
  ],
  proc_status: [
    { value: 'EDB76064-AF15-4309-B5D1-2FD1133BA560', label: '配案中' },
    { value: '2CED187C-582F-406B-A8EB-B8969EE7F896', label: '撰写中' },
    { value: 'D6B45473-87E0-4904-8447-A21B0BF123A8', label: '内部审核' },
    { value: 'D60E4F6B-0710-4BB6-B93B-8E7CEFC95DC7', label: '外部审核' },
    { value: 'F7EC0F03-F1FC-4C0C-8ADF-22227510CFD1', label: '递交中' },
    { value: '66243386-8557-4791-9712-A35D6F92D289', label: '暂停/客户延期' },
    { value: 'b5307f4b-de97-4fa9-9c82-f0d2b6ab638a', label: '待通知客户' },
    { value: '43fe30a3-56c0-4a59-8296-dfc84704b27b', label: '已通知客户' },
    { value: 'd381b4d2-0da3-4df7-9f16-81c08a55e19e', label: '客户自缴' },
    { value: 'a6e7a4c9-f5ca-406e-ba18-d47b1e8d02ce', label: '客户已付款' },
    { value: 'CA504C3D-3499-495C-87AC-9693E0DF0E47', label: '客户定稿' },
    { value: '3490D238-E99B-48E7-B0B9-46BF43A7C07F', label: '完成' },
    { value: '2CBC74BC-1ACF-4A61-8AD5-5FF3F0287AFC', label: '结案' },
    { value: 'f1030ff7-16d5-4efc-9a1e-cb81d27522f3', label: '客户审核通过，进入国家阶段' },
    { value: '325191b6-0c97-48ad-8411-d5a6a527b53d', label: '不用递交' },
    { value: 'cae3dddb-2e52-482f-a8a9-04325929bb9a', label: '待收到回执/纸件' },
    { value: '9f443765-1120-43d4-a358-316720788143', label: '客户已指示' },
    { value: 'f9b2f262-626e-42ad-997c-aad954230246', label: '退回修改' }
  ]
}

const checks: CheckCell = {
  kind: 'checks',
  label: '其它属性',
  items: [
    { key: 'is_essence_exam', label: '同时提实审' },
    { key: 'is_ahead_pub', label: '提前公布' },
    { key: 'is_confidential_request', label: '请求保密审查' },
    { key: 'is_fee_reduce', label: '请求费用减缓' },
    { key: 'is_speed_checkd', label: '优先审查' },
    { key: 'is_request_das', label: '同时请求DAS码' },
    { key: 'hearing_the_case', label: '预审案件' },
    { key: 'is_examine_delay', label: '延迟审查' }
  ]
}

export function cellKeys(cell: QueryCell): string[] {
  if (cell.kind === 'download-name') return ['filetemp']
  if (cell.kind === 'dates') return [cell.start, cell.end, cell.empty].filter((key): key is string => Boolean(key))
  if (cell.kind === 'checks') return cell.items.map(item => item.key)
  return [cell.key]
}

function visibleCells(cells: QueryCell[], hidden: ReadonlySet<string>): QueryCell[] {
  return cells.filter(cell => cellKeys(cell).some(key => !hidden.has(key)))
}

/** 第一屏就展示的条件。往下滚到的其余字段不在这里。 */
export function primaryQueryKeys(): ReadonlySet<string> {
  return new Set(QUERY_BLOCKS.filter(block => !block.more).flatMap(block => block.cells.flatMap(cellKeys)))
}

/** 常用条件一直显示。更多条件挂在同一段下面，案件和文件各自展开。 */
export function queryBlocks(hidden: ReadonlySet<string>): QuerySection[] {
  return [
    { title: '案件条件', match: '案件' },
    { title: '文件条件', match: '文件' }
  ].map(group => {
    const related = QUERY_BLOCKS.filter(block => block.title.includes(group.match))
    return {
      title: group.title,
      cells: visibleCells(related.filter(block => !block.more).flatMap(block => block.cells), hidden),
      extra: visibleCells(related.filter(block => block.more).flatMap(block => block.cells), hidden)
    }
  }).filter(block => block.cells.length > 0 || block.extra.length > 0)
}

export const QUERY_BLOCKS: QueryBlock[] = [
  {
    title: '案件条件',
    cells: [
      { kind: 'text', key: 'case_volume', label: '我方文号' },
      { kind: 'text', key: 'case_volume_customer', label: '客户文号' },
      { kind: 'text', key: 'case_name', label: '案件名称' },
      { kind: 'text', key: 'app_no', label: '申请号' },
      { kind: 'text', key: 'issue_no', label: '注册号' },
      { kind: 'text', key: 'pub_no', label: '登记号' },
      { kind: 'text', key: 'customer_name_vague', label: '客户名称' },
      { kind: 'text', key: 'customer_code', label: '客户代码' },
      { kind: 'named', key: 'customer_country', label: '客户国家(地区)' },
      { kind: 'select', key: 'case_type', label: '案件类型' },
      { kind: 'named', key: 'flow_direction', label: '案件流向' },
      { kind: 'named', key: 'dept_id', label: '承办部门' }
    ]
  },
  {
    title: '文件条件',
    cells: [
      { kind: 'files', key: 'filetype', label: '文件描述' },
      { kind: 'named', key: 'fileclass', label: '文件来源' },
      { kind: 'select', key: 'file_status', label: '文件处理状态' },
      { kind: 'dates', label: '官方发文日', start: 'post_s', end: 'post_e', empty: 'post_isnull' },
      { kind: 'text', key: 'file_name', label: '附件名称' },
      { kind: 'select', key: 'selfilePath', label: '子文件目录' },
      { kind: 'named', key: 'upuser', label: '上传者' },
      { kind: 'dates', label: '上传日期', start: 'update_s', end: 'update_e', empty: 'update_isnull' },
      { kind: 'dates', label: '文件收文日期', start: 'file_receipt_date_s', end: 'file_receipt_date_e', empty: 'file_receipt_date_isnull' }
    ]
  },
  {
    title: '更多案件条件',
    more: true,
    cells: [
      { kind: 'named', key: 'apply_type', label: '申请类型' },
      { kind: 'named', key: 'country', label: '申请国家(地区)' },
      { kind: 'dates', label: '申请日', start: 'app_date_s', end: 'app_date_e', empty: 'app_date_isnull' },
      { kind: 'text', key: 'applicant', label: '申请人' },
      { kind: 'named', key: 'customer_flow_user', label: '客户流程人员' },
      { kind: 'named', key: 'customer_status_id', label: '客户状态' },
      { kind: 'named', key: 'agency_id', label: '代理机构' },
      { kind: 'named', key: 'sales', label: '业务员' },
      { kind: 'named', key: 'sale_dept_id', label: '业务员部门' },
      { kind: 'named', key: 'sales_help', label: '业务助理' },
      { kind: 'text', key: 'introducer', label: '外部案源人' },
      { kind: 'text', key: 'case_remark', label: '案件备注' },
      { kind: 'named', key: 'agency_user_id', label: '案件处理人' },
      { kind: 'text', key: 'app_area_name', label: '第一申请人行政区划' },
      { kind: 'select', key: 'is_close', label: '是否包含结案' },
      { kind: 'named', key: 'branch_dept_id', label: '所属分部' },
      { kind: 'dates', label: '公告日', start: 'issue_date_s', end: 'issue_date_e', empty: 'issue_date_isnull' },
      { kind: 'dates', label: '事项收文日期', start: 'proc_receipt_date_s', end: 'proc_receipt_date_e', empty: 'proc_receipt_date_isnull' },
      { kind: 'named', key: 'apply_tags_id', label: '专利标签' },
      { kind: 'text', key: 'proc_remark', label: '处理事项备注' },
      { kind: 'named', key: 'business_type_id', label: '业务类型' },
      { kind: 'select', key: 'is_vip', label: '是否大客户' },
      { kind: 'text', key: 'specialtyid', label: '专业领域' },
      { kind: 'named', key: 'case_flow_user', label: '案件流程人员' },
      { kind: 'named', key: 'user_assistant', label: '案件处理人助理' },
      { kind: 'text', key: 'inventor_name', label: '发明人' },
      { kind: 'text', key: 'contact_name_zf', label: '专利负责人' },
      { kind: 'text', key: 'column1', label: '自定义栏位1' },
      { kind: 'text', key: 'column2', label: '特批编号' },
      { kind: 'text', key: 'column3', label: '回款日期' },
      { kind: 'text', key: 'column4', label: '业务立案编号' },
      { kind: 'text', key: 'column5', label: '所属部门' },
      checks
    ]
  },
  {
    title: '更多文件条件',
    more: true,
    cells: [
      { kind: 'named', key: 'i_ctrl_proc', label: '处理事项' },
      { kind: 'select', key: 'proc_status', label: '处理事项状态' },
      { kind: 'dates', label: '处理事项完成日', start: 'finish_date_s', end: 'finish_date_e', empty: 'finish_date_isnull' },
      { kind: 'named', key: 'pic_user', label: '处理事项处理人' },
      { kind: 'named', key: 'foreign_pic', label: '事项对外处理人' },
      { kind: 'named', key: 'case_status', label: '案件状态' },
      { kind: 'checks', label: '案件状态', items: [{ key: 'case_status_notequals', label: '不等于' }] },
      { kind: 'named', key: 'revise_user_id', label: '核稿人' },
      { kind: 'dates', label: '返稿日', start: 'back_date_start', end: 'back_date_end' },
      { kind: 'dates', label: '返发明人日', start: 'back_inventor_date_start', end: 'back_inventor_date_end' },
      { kind: 'text', key: 'receive_name', label: '领取人' },
      { kind: 'dates', label: '客户领取日期', start: 'cus_receive_date_s', end: 'cus_receive_date_e', empty: 'cus_receive_date_isnull' },
      { kind: 'select', key: 'ofileType', label: '官方来文类型' },
      { kind: 'text', key: 'file_name_batch', label: '附件名称（批量）' },
      { kind: 'text', key: 'file_remark', label: '文件备注' },
      { kind: 'named', key: 'payment_review_user_id', label: '复核人' },
      { kind: 'dates', label: '复核时间', start: 'payment_review_time_s', end: 'payment_review_time_e', empty: 'payment_review_time_isnull' },
      { kind: 'named', key: 'pat_production_user_id', label: '制作者' },
      { kind: 'dates', label: '制作时间', start: 'update_production_user_time_s', end: 'update_production_user_time_e', empty: 'update_production_user_time_isnull' },
      { kind: 'named', key: 'pat_patauditor_user_id', label: '审核者' },
      { kind: 'dates', label: '审核时间', start: 'update_patauditor_user_time_s', end: 'update_patauditor_user_time_e', empty: 'update_patauditor_user_time_isnull' },
      { kind: 'named', key: 'pat_allocator_user_id', label: '分配者' },
      { kind: 'dates', label: '分配时间', start: 'update_allocator_user_time_s', end: 'update_allocator_user_time_e', empty: 'update_allocator_user_time_isnull' },
      { kind: 'download-name' }
    ]
  }
]
