import type { MailGroup, SubjectRule } from '../types'

const VARIABLES = ['文件名称', '客户名称', '我方文号', '申请号', '文件数量'] as const

export interface BuiltText {
  text: string
  unresolved: string[]
  needsConfirm: boolean
}

function uniqueJoin(values: Array<string | undefined>): string {
  return [...new Set(values.map(value => value?.trim() ?? '').filter(Boolean))].join('、')
}

export function renderTemplate(template: string, values: Record<string, string>): BuiltText {
  const unresolved: string[] = []
  const text = template.replace(/\{([^{}]+)\}/g, (token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      unresolved.push(name)
      return token
    }
    return values[name] ?? ''
  })
  return { text, unresolved, needsConfirm: false }
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

export function buildSubject(rule: SubjectRule, group: MailGroup, customerName: string): BuiltText {
  const values: Record<string, string> = {
    文件名称: uniqueJoin(group.files.map(file => file.fileName)),
    客户名称: customerName,
    我方文号: uniqueJoin(group.files.map(file => file.caseVolume)),
    申请号: uniqueJoin(group.files.map(file => file.applicationNo)),
    文件数量: String(group.files.length)
  }
  const rendered = renderTemplate(rule.template, values)
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
