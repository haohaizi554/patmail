import type { MailGroup, SelectedPatentFile, SubjectRule } from '../types'

const VARIABLES = [
  '文件名称', '客户名称', '我方文号', '我方文号范围', '贵方案号', '贵方案号范围',
  '客户文号', '客户文号范围', '申请号', '申请号范围', '案件名称', '文件描述', '发文类型',
  '文件数量', '日期', '公告日'
] as const

export const TEMPLATE_TOKENS: ReadonlyArray<{ name: string; hint: string }> = [
  { name: '贵方案号', hint: '客户文号。没有时整段连同后面的一个 - 一起去掉。' },
  { name: '我方文号', hint: '没有时整段连同后面的一个 - 一起去掉。' },
  { name: '案件名称', hint: '原站默认主题里的案件名称。没有时去掉。' },
  { name: '发文类型', hint: '文件描述映射到的发文类型名称。' },
  { name: '贵方案号范围', hint: '多件取第一件和最后一件，中间用 - 连接。一件只写这一件。' },
  { name: '文件数量', hint: '这封邮件里的文件件数。后面的「件」自己写。' },
  { name: '发文类型', hint: '文件描述映射到的发文类型名称，例如专利电子证书。' },
  { name: '文件描述', hint: '查询结果里的文件描述原文。' },
  { name: '客户名称', hint: '当前客户名称。' },
  { name: '日期', hint: '生成当天，形如 20260922。' },
  { name: '公告日', hint: '文件公告日，去掉分隔符。多件不同时取第一天和最后一天。' },
  { name: '申请号范围', hint: '多件取第一件和最后一件申请号。' },
  { name: '申请号', hint: '全部申请号，用顿号隔开。' },
  { name: '我方文号范围', hint: '多件取第一件和最后一件我方文号。' },
  { name: '我方文号', hint: '全部我方文号，用顿号隔开。' },
  { name: '文件名称', hint: '全部文件名，用顿号隔开。' }
]

export interface BuiltText {
  text: string
  unresolved: string[]
  needsConfirm: boolean
}

export interface TemplateExtra {
  mailTypeName?: string
  now?: Date
}

function orderedUnique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = value?.trim() ?? ''
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function uniqueJoin(values: Array<string | undefined>): string {
  return orderedUnique(values).join('、')
}

/** 多件写成「第一件-最后一件」，一件只保留这一件。 */
export function valueRange(values: Array<string | undefined>): string {
  const unique = orderedUnique(values)
  if (unique.length <= 1) return unique[0] ?? ''
  return `${unique[0]}-${unique[unique.length - 1]}`
}

function compactDay(value: string): string {
  const match = value.trim().match(/^(\d{4})\D?(\d{2})\D?(\d{2})/)
  return match ? `${match[1]}${match[2]}${match[3]}` : value.trim()
}

function compactToday(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}${month}${day}`
}

/** 已知占位符没有内容时删掉，并去掉紧跟在后面的一个「-」。不认识的占位符原样留下。 */
export function renderTemplate(template: string, values: Record<string, string>): BuiltText {
  const unresolved: string[] = []
  let text = ''
  const pattern = /\{([^{}]+)\}/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) {
    const name = match[1]
    const before = template.slice(last, match.index)
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      unresolved.push(name)
      text += before + match[0]
      last = match.index + match[0].length
      continue
    }
    const value = values[name]?.trim() ?? ''
    if (!value) {
      const dropDash = template.slice(match.index + match[0].length).startsWith('-') ? 1 : 0
      last = match.index + match[0].length + dropDash
      if (!(text === '' && /^[-－]$/.test(before))) text += before
      continue
    }
    text += before + value
    last = match.index + match[0].length
  }
  text += template.slice(last)
  return { text: text.replace(/-{2,}/g, '-'), unresolved, needsConfirm: false }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 从原始模板重新生成。锚点后已有“N个”时不再插入。 */
export function injectCount(text: string, count: number, anchor: string): string {
  if (count <= 1 || !anchor || !text.includes(anchor)) return text
  const injected = new RegExp(`${escapeRegExp(anchor)}\\d+个`)
  if (injected.test(text)) return text
  const index = text.indexOf(anchor)
  const at = index + anchor.length
  return `${text.slice(0, at)}${count}个${text.slice(at)}`
}

export function templateValues(files: SelectedPatentFile[], customerName: string, extra?: TemplateExtra): Record<string, string> {
  const customerVolumes = files.map(file => file.customerVolume)
  const applicationNos = files.map(file => file.applicationNo)
  const ourVolumes = files.map(file => file.caseVolume)
  const customerVolume = uniqueJoin(customerVolumes)
  const customerVolumeRange = valueRange(customerVolumes)
  const applicationNo = uniqueJoin(applicationNos)
  const applicationRange = valueRange(applicationNos)
  const ourVolume = uniqueJoin(ourVolumes)
  const ourRange = valueRange(ourVolumes)
  const description = uniqueJoin(files.map(file => file.fileDescription))
  const mailType = extra?.mailTypeName?.trim() ?? ''
  const posted = valueRange(files.map(file => file.officialPostDate ? compactDay(file.officialPostDate) : ''))
  return {
    文件名称: uniqueJoin(files.map(file => file.fileName)),
    客户名称: customerName.trim(),
    我方文号: ourVolume,
    我方文号范围: ourRange,
    贵方案号: customerVolume,
    客户文号: customerVolume,
    贵方案号范围: customerVolumeRange,
    客户文号范围: customerVolumeRange,
    申请号: applicationNo,
    申请号范围: applicationRange,
    案件名称: uniqueJoin(files.map(file => file.caseName)),
    文件描述: description,
    发文类型: mailType,
    文件数量: String(files.length),
    日期: compactToday(extra?.now ?? new Date()),
    公告日: posted
  }
}

export function buildSubject(rule: SubjectRule, group: MailGroup, customerName: string, extra?: TemplateExtra): BuiltText {
  const rendered = renderTemplate(rule.template, templateValues(group.files, customerName, extra))
  if (!rule.countInjection || group.files.length <= 1) return rendered
  if (rule.anchor && rendered.text.includes(rule.anchor)) {
    return { ...rendered, text: injectCount(rendered.text, group.files.length, rule.anchor) }
  }
  if (rule.missingAnchor === 'prefix' && rule.anchor) {
    return { ...rendered, text: `${rule.anchor}${group.files.length}个${rendered.text}` }
  }
  if (rule.missingAnchor === 'confirm') return { ...rendered, needsConfirm: true }
  return rendered
}

export function knownSubjectVariables(): readonly string[] {
  return VARIABLES
}
