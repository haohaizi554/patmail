import type { BodyRule, MailGroup } from '../types'
import { renderTemplate, type BuiltText } from './subject-builder'

export function buildBody(rule: BodyRule, group: MailGroup, customerName: string, signature: string): BuiltText {
  const values: Record<string, string> = {
    文件名称: group.files.map(file => file.fileName).join('、'),
    客户名称: customerName,
    我方文号: group.files.map(file => file.caseVolume ?? '').filter(Boolean).join('、'),
    申请号: group.files.map(file => file.applicationNo ?? '').filter(Boolean).join('、'),
    文件数量: String(group.files.length)
  }
  const base = renderTemplate(rule.template, values)
  const extra = renderTemplate(rule.supplement, values)
  const parts = [base.text.trim(), extra.text.trim()].filter(Boolean)
  const signatureText = signature.trim()
  const joined = parts.join('\n\n')
  const withSignature = signatureText && !joined.includes(signatureText) ? `${joined}${joined ? '\n\n' : ''}${signatureText}` : joined
  return {
    text: withSignature,
    unresolved: [...base.unresolved, ...extra.unresolved],
    needsConfirm: false
  }
}
