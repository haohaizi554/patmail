import { isFileSearchBusinessField, type FileSearchQuery } from '../api/file-search-params'
import { isForbiddenFieldName } from '../query/field-registry'
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
      { id: 'ctrl_proc', label: '处理事项', decidedBy: '表格「处理事项」。查询时只能从列表里选择，不能手填。这批清单是「提醒申请PCT」。' },
      { id: 'our_volume', label: '我方文号', decidedBy: '表格「我方文号」。可以一个一个查，也可以用分号、空格或换行放在一起查。' },
      { id: 'customer_volume', label: '客户文号', decidedBy: '表格「客户文号」。' },
      { id: 'volume', label: '发文类型', decidedBy: '从原网站的发文类型树热加载。有客户文号对名称里带「贵方案号」和「深圳市」的那一项；没有客户文号、有我方文号时对带「我方案号」和「深圳市」、且不是非深圳市的那一项。' },
      { id: 'mail_style', label: '发文模式', options: LIMIT_MAIL_STYLES },
      { id: 'customer_name', label: '客户名称', decidedBy: '表格「客户名称」。' },
      { id: 'to', label: '收件人', decidedBy: '表格「第一客户联系人」，角色是第一发明人（技术联系人）。' },
      { id: 'cc', label: '抄送', decidedBy: '商务，以及表格「客户联系人(IPR)」。' },
      { id: 'from', label: '发件人', decidedBy: '国际部公用邮箱。发件页按这个角色热加载。' },
      { id: 'review', label: '审核', options: [{ value: 'self', label: '提交给当前登录人' }] }
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
    if (!text || text.length > 4000) continue
    output[key] = text
    if (Object.keys(output).length >= 160) break
  }
  return output
}

export function isBoundQuery(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 160) return false
  return entries.every(([key, raw]) => BOUND_KEY.test(key) && !isForbiddenFieldName(key) && typeof raw === 'string' && raw.length <= 4000)
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

export function summarizeBoundQuery(fields: Record<string, string> | undefined): string {
  const entries = Object.entries(fields ?? {}).filter(([, value]) => value.trim())
  if (!entries.length) return '还没绑定'
  return entries.slice(0, 4).map(([key, value]) => {
    const shown = GUID.test(value) ? '已选择' : value.length > 24 ? `${value.slice(0, 24)}…` : value
    return `${BOUND_LABELS[key] ?? key}：${shown}`
  }).join('，')
}

/** 鹏城实验室这份清单里，处理事项整列都是这个值。查询时对的是处理事项，不是文号。 */
export const PCT_REMINDER = {
  procLabel: '提醒申请PCT',
  queryFieldLabel: '处理事项',
  columns: ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
  contacts: {
    from: { role: '国际部公用邮箱', example: 'info@centips.com' },
    to: { role: '第一发明人（技术联系人）', example: '姜颖 <liy02@pcl.ac.cn>' },
    cc: [
      { role: '商务', example: '林淑敏 <linsm@centips.com>' },
      { role: 'IPR', example: '雷群安 <leiqa@pcl.ac.cn>' }
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

/** 有客户文号用贵方案号那一项；没有客户文号但有我方文号用我方案号深圳市那一项。两个都没有就不猜。 */
export function pctVolumeSlot(input: { customerVolume?: string; ourVolume?: string }): PctVolumeSlot | null {
  if (input.customerVolume?.trim()) return { id: 'customer_volume', radioIndex: 1 }
  if (input.ourVolume?.trim()) return { id: 'our_volume_shenzhen', radioIndex: 3 }
  return null
}

function shenzhen(name: string): boolean {
  return name.includes('深圳市') && !name.includes('非深圳市')
}

/** 在热加载的发文类型树里按名称对上 PCT 提醒的三项。对不上就留空，不写死名称。 */
export function matchPctMailTypes(nodes: Array<{ id: string; name: string }>): PctMailTypeMatch {
  const reminder = nodes.filter(node => node.id.trim() && node.name.includes('提醒申请PCT'))
  return {
    customerVolume: reminder.find(node => node.name.includes('贵方案号') && shenzhen(node.name)) ?? null,
    ourVolumeOtherCity: reminder.find(node => node.name.includes('我方案号') && node.name.includes('非深圳市')) ?? null,
    ourVolumeShenzhen: reminder.find(node => node.name.includes('我方案号') && shenzhen(node.name)) ?? null
  }
}

export function pctMailTypeFor(input: { customerVolume?: string; ourVolume?: string }, nodes: Array<{ id: string; name: string }>): (PctMailTypeNode & { radioIndex: 1 | 3 }) | null {
  const slot = pctVolumeSlot(input)
  if (!slot) return null
  const matched = matchPctMailTypes(nodes)
  const node = slot.id === 'customer_volume' ? matched.customerVolume : matched.ourVolumeShenzhen
  if (!node) return null
  return { ...node, radioIndex: slot.radioIndex }
}
