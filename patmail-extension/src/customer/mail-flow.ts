import { fileSearchValueLimit, isFileSearchBusinessField, type FileSearchQuery } from '../api/file-search-params'
import { isForbiddenFieldName, fieldLabel } from '../query/field-registry'
import { PAGE_OPTIONS } from '../query/form-layout'
import { PCT_CUSTOMER_VOLUME_TYPE_NAME, PCT_OUR_VOLUME_TYPE_NAME, resolvePctRuntime, type PctRuntimeConfig } from '../workflow/pct-config'
import type { CustomerQueryProfile, FileMailStyle, LimitMailStyle, QuerySurfaceId, WorkflowId } from './types'

/** 查询入口。以后新增入口只加这一项，客户页按这份清单渲染。 */
export const QUERY_SURFACES: { id: QuerySurfaceId; label: string; hash: string }[] = [
  { id: 'file', label: '文件查询', hash: '/files' },
  { id: 'limit', label: '期限监控', hash: '/limits' }
]

/**
 * 期限监控弹层当前看得见的三种发文模式。
 * 来源：API/09-期限监控.md。mailstyle 4 到 6 在页面上默认隐藏，这里不放进一对一选项。
 */
export const LIMIT_MAIL_STYLES: { value: LimitMailStyle; label: string }[] = [
  { value: '1', label: '同客户合并发文' },
  { value: '2', label: '单个来文发文' },
  { value: '3', label: '同客户第一联系人合并发文' }
]

/**
 * 文件管理「选择发文模式」弹层，页面是 FileSearchMail.aspx。
 * 来源：API/07。默认项是「同客户合并发文」，提交值 mailstyle=1。
 * 单个来文在文件分组里有，这次抓包没有它的 mailstyle，所以不写成数字。
 */
export const FILE_MAIL_STYLES: { value: FileMailStyle; label: string }[] = [
  { value: 'merge_by_customer_description', label: '同客户合并发文' },
  { value: 'single_file', label: '单个来文发文' }
]

export interface WorkflowMode {
  id: string
  label: string
  /** 由表格列决定。客户页展示规则，不再手填一份。 */
  decidedBy?: string
  options?: { value: string; label: string }[]
}

export interface PackagedWorkflow {
  id: WorkflowId
  label: string
  surface: QuerySurfaceId
  modes: WorkflowMode[]
}

/** 已封装的工作流。以后新增工作流只加这一项。 */
export const WORKFLOWS: PackagedWorkflow[] = [
  {
    id: 'pct-reminder',
    label: 'PCT提醒',
    surface: 'limit',
    modes: [
      { id: 'ctrl_proc', label: '处理事项', decidedBy: '表格「处理事项」。上传后按这个名称到原网站的处理事项列表里对上再查。' },
      { id: 'our_volume', label: '我方文号', decidedBy: '表格「我方文号」。可以一个一个查，也可以用分号、空格或换行放在一起查。' },
      { id: 'customer_volume', label: '客户文号', decidedBy: '表格「客户文号」。' },
      { id: 'volume', label: '发文类型', decidedBy: `到发文类型下拉里按完整名称对上。有客户文号用「${PCT_CUSTOMER_VOLUME_TYPE_NAME}」。只有我方文号用「${PCT_OUR_VOLUME_TYPE_NAME}」。` },
      { id: 'mail_style', label: '发文模式', options: LIMIT_MAIL_STYLES },
      { id: 'customer_name', label: '客户名称', decidedBy: '表格「客户名称」。' },
      { id: 'to', label: '收件人', decidedBy: '表格「客户联系人(IPR)」。' },
      { id: 'cc', label: '抄送', decidedBy: '发文页的商务。' },
      { id: 'from', label: '发件人', decidedBy: '从原网站的发件邮箱列表热加载，在这里或创建任务时选择。' },
      { id: 'review', label: '审核', options: [{ value: 'self', label: '提交给当前登录人' }] }
    ]
  },
  {
    id: 'pct-pengcheng',
    label: 'PCT鹏城专案',
    surface: 'limit',
    modes: [
      { id: 'ctrl_proc', label: '处理事项', decidedBy: '表格「处理事项」。' },
      { id: 'our_volume', label: '我方文号', decidedBy: '表格「我方文号」。' },
      { id: 'to', label: '收件人', decidedBy: '表格「技术负责人」。括号里的拼音会去掉再对联系人。' },
      { id: 'cc', label: '抄送', decidedBy: '表格「客户联系人(IPR)」，再加上发文页的商务。邮箱那一列不读。' },
      { id: 'review', label: '审核', options: [{ value: 'self', label: '提交给当前登录人' }] }
    ]
  },
  {
    id: 'file-manage',
    label: '文件管理',
    surface: 'file',
    modes: [
      { id: 'query', label: '查询条件', decidedBy: '这位客户已绑定的查询条件。' },
      { id: 'mail_style', label: '发文方式', options: FILE_MAIL_STYLES },
      { id: 'mail_type', label: '发文类型', decidedBy: '发文映射里，文件描述一对一对应的发文类型。' },
      { id: 'to', label: '收件人', decidedBy: '发文页的案件联系人。' },
      { id: 'cc', label: '抄送', decidedBy: '默认发件人，同时抄送商务。' },
      { id: 'sender', label: '发件人', decidedBy: '发文映射里的默认发件人。' },
      { id: 'reviewer', label: '审核人', decidedBy: '发文映射里的默认审核人。' },
      { id: 'subject', label: '标题', decidedBy: '发文映射里的标题模板。' },
      { id: 'signature', label: '签名', decidedBy: '发文映射里选中的默认签名。原站的按发文页邮件签名下拉的格式写进正文。' }
    ]
  }
]

export function isWorkflowId(value: unknown): value is WorkflowId {
  return WORKFLOWS.some(item => item.id === value)
}

export function workflowsFor(surface: QuerySurfaceId | ''): PackagedWorkflow[] {
  if (!surface) return []
  return WORKFLOWS.filter(item => item.surface === surface)
}

export function mailStylesFor(surface: QuerySurfaceId | ''): { value: string; label: string }[] {
  if (surface === 'file') return FILE_MAIL_STYLES
  if (surface === 'limit') return LIMIT_MAIL_STYLES
  return []
}

export const PENDING_CUSTOMER_KEY = 'patmail.pendingCustomer'
export const PCT_RESUME_KEY = 'patmail.pctResume'

const BOUND_KEY = /^[A-Za-z][A-Za-z0-9_]{0,80}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isQuerySurface(value: unknown): value is QuerySurfaceId {
  return value === 'file' || value === 'limit'
}

export function isLimitMailStyle(value: unknown): value is LimitMailStyle {
  return value === '1' || value === '2' || value === '3'
}

export function isFileMailStyle(value: unknown): value is FileMailStyle {
  return value === 'merge_by_customer_description' || value === 'single_file'
}

export function querySurfaceOf(id: string | undefined): { id: QuerySurfaceId; label: string; hash: string } {
  return QUERY_SURFACES.find(item => item.id === id) ?? QUERY_SURFACES[0]
}

export function limitMailStyleLabel(value: string | undefined): string {
  return LIMIT_MAIL_STYLES.find(item => item.value === value)?.label ?? '还没选发文模式'
}

export function customerMailStyleLabel(profile: { querySurface?: QuerySurfaceId; limitMailStyle?: string; fileMailStyle?: string }): string {
  const surface = profile.querySurface ?? 'file'
  const value = surface === 'limit' ? profile.limitMailStyle : profile.fileMailStyle
  return mailStylesFor(surface).find(item => item.value === value)?.label ?? '还没选发文模式'
}

/** 最后一次提交的字段。空值丢掉，不记录中间改过哪些步骤。 */
export function querySnapshot(fields: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!BOUND_KEY.test(key) || isForbiddenFieldName(key)) continue
    const text = value.trim()
    if (!text || text.length > fileSearchValueLimit(key)) continue
    output[key] = text
    if (Object.keys(output).length >= 160) break
  }
  return output
}

export function isBoundQuery(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 160) return false
  return entries.every(([key, raw]) => BOUND_KEY.test(key) && !isForbiddenFieldName(key) && typeof raw === 'string' && raw.length <= fileSearchValueLimit(key))
}

export function snapshotFromFileQuery(query: Pick<FileSearchQuery, 'resolvedFields' | 'caseVolume' | 'applicationNo' | 'customerName' | 'fileName' | 'fileDescriptionId'>): Record<string, string> {
  if (query.resolvedFields) return querySnapshot(query.resolvedFields)
  return querySnapshot({
    case_volume: query.caseVolume ?? '',
    app_no: query.applicationNo ?? '',
    customer: query.customerName ?? '',
    file_name: query.fileName ?? '',
    filetype: query.fileDescriptionId ?? ''
  })
}

export function applyBoundQuery(profile: CustomerQueryProfile, input: {
  surface: QuerySurfaceId
  fields: Record<string, string>
  templateId?: string
  reviewSelf?: boolean
}): CustomerQueryProfile {
  const boundQuery = querySnapshot(input.fields)
  const fileOverrides = Object.fromEntries(Object.entries(boundQuery).filter(([key]) => isFileSearchBusinessField(key)))
  const next: CustomerQueryProfile = {
    ...profile,
    querySurface: input.surface,
    baseTemplateId: input.templateId?.trim() || profile.baseTemplateId || 'manual',
    boundQuery,
    overrides: input.surface === 'file' ? fileOverrides : {}
  }
  if (input.reviewSelf) next.reviewTarget = 'self'
  else delete next.reviewTarget
  if (profile.pctTask) {
    next.pctTask = {
      workflowId: 'pct-reminder',
      ctrlProcId: profile.pctTask.ctrlProcId,
      createdAt: profile.pctTask.createdAt,
      confirmedProcIds: [...profile.pctTask.confirmedProcIds],
      ...(profile.pctTask.mailsetId && profile.pctTask.mailsetLabel ? { mailsetId: profile.pctTask.mailsetId, mailsetLabel: profile.pctTask.mailsetLabel } : {}),
      ...(profile.pctTask.mailTo ? { mailTo: profile.pctTask.mailTo } : {}),
      ...(profile.pctTask.mailCc ? { mailCc: profile.pctTask.mailCc } : {}),
      rows: profile.pctTask.rows.map(row => ({ ...row }))
    }
  }
  return next
}

const BOUND_LABELS: Record<string, string> = {
  ctrl_proc: '处理事项',
  case_volume: '我方文号',
  case_volume_customer: '客户文号',
  customer_name: '客户名称',
  customer: '客户',
  app_no: '申请号',
  file_name: '文件名',
  filetype: '文件描述'
}
const SUMMARY_LATER = new Set(['case_type', 'fileclass'])

function boundLabel(key: string): string {
  return BOUND_LABELS[key] ?? (fieldLabel(key) === '其他条件' ? '条件' : fieldLabel(key))
}

function boundValue(key: string, value: string): string {
  const option = PAGE_OPTIONS[key]?.find(item => item.value === value)
  if (option?.label) return option.label
  if (key === 'fileclass' && value === 'general') return '所有文件'
  const parts = value.split(',').map(item => item.trim()).filter(Boolean)
  if (parts.length > 1 && parts.every(part => GUID.test(part))) return `${parts.length} 项`
  if (GUID.test(value)) return '已选择'
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

export function summarizeBoundQuery(fields: Record<string, string> | undefined): string {
  const entries = Object.entries(fields ?? {}).filter(([, value]) => value.trim())
  if (!entries.length) return '还没绑定'
  const ranked = [
    ...entries.filter(([key]) => !SUMMARY_LATER.has(key)),
    ...entries.filter(([key]) => SUMMARY_LATER.has(key))
  ]
  return ranked.slice(0, 4).map(([key, value]) => `${boundLabel(key)}：${boundValue(key, value)}`).join('，')
}

/** 鹏城实验室这份清单里，处理事项整列都是这个值。查询时对的是处理事项，不是文号。 */
export const PCT_REMINDER = {
  procLabel: '提醒申请PCT',
  queryFieldLabel: '处理事项',
  columns: ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
  contacts: {
    from: { role: '发件邮箱', example: '从原站发件人列表选择' },
    to: { role: '一般客户是 IPR；工作流里写下的客户是第一发明人（技术联系人）', example: '姜颖 <liy02@pcl.ac.cn>' },
    cc: [
      { role: '一般客户抄送业务人员', example: '林淑敏 <linsm@centips.com>' },
      { role: '工作流里写下的客户抄送 IPR', example: '雷群安 <leiqa@pcl.ac.cn>' }
    ]
  }
} as const

export type PctVolumeSlot = {
  id: 'customer_volume' | 'our_volume_shenzhen'
  radioIndex: 1 | 3
}

export interface PctMailTypeNode {
  id: string
  name: string
}

export interface PctMailTypeMatch {
  customerVolume: PctMailTypeNode | null
  ourVolumeOtherCity: PctMailTypeNode | null
  ourVolumeShenzhen: PctMailTypeNode | null
}

/** 有客户文号走贵方案号那一项；没有客户文号但有我方文号走我方案号深圳市那一项。两个都没有就不猜。 */
export function pctVolumeSlot(input: { customerVolume?: string; ourVolume?: string }, config?: PctRuntimeConfig): PctVolumeSlot | null {
  const runtime = resolvePctRuntime(config)
  if (input.customerVolume?.trim()) return { id: 'customer_volume', radioIndex: runtime.customerRadio }
  if (input.ourVolume?.trim()) return { id: 'our_volume_shenzhen', radioIndex: runtime.ourRadio }
  return null
}

function pickedType(nodes: Array<{ id: string; name: string }>, id: string): PctMailTypeNode | null {
  const text = id.trim()
  if (!text) return null
  const found = nodes.find(node => node.id === text && node.name.trim())
  return found ? { id: found.id, name: found.name } : null
}

/** 下拉里名称与完整全名一致才算对上。只包含其中几个词的不算。同名多于一项时不猜。 */
function byExactName(nodes: Array<{ id: string; name: string }>, name: string): PctMailTypeNode | null {
  const text = name.trim()
  if (!text) return null
  const found = nodes.filter(node => node.id.trim() && node.name.trim() === text)
  return found.length === 1 ? { id: found[0].id, name: found[0].name.trim() } : null
}

/** 点名选定的优先。没选定，或这次名单里没有它，再按完整名称到下拉里找。对不上就留空。 */
export function matchPctMailTypes(nodes: Array<{ id: string; name: string }>, config?: PctRuntimeConfig): PctMailTypeMatch {
  const runtime = resolvePctRuntime(config)
  return {
    customerVolume: pickedType(nodes, runtime.customerTypeId) ?? byExactName(nodes, runtime.customerTypeName || PCT_CUSTOMER_VOLUME_TYPE_NAME),
    ourVolumeOtherCity: null,
    ourVolumeShenzhen: pickedType(nodes, runtime.ourTypeId) ?? byExactName(nodes, runtime.ourTypeName || PCT_OUR_VOLUME_TYPE_NAME)
  }
}

export function pctMailTypeFor(input: { customerVolume?: string; ourVolume?: string }, nodes: Array<{ id: string; name: string }>, config?: PctRuntimeConfig): (PctMailTypeNode & { radioIndex: 1 | 3 }) | null {
  const slot = pctVolumeSlot(input, config)
  if (!slot) return null
  const matched = matchPctMailTypes(nodes, config)
  const node = slot.id === 'customer_volume' ? matched.customerVolume : matched.ourVolumeShenzhen
  if (!node) return null
  return { ...node, radioIndex: slot.radioIndex }
}
