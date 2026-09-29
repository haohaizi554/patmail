import type { BodyRule, MailGroup } from '../types'
import { renderTemplate, templateValues, type BuiltText, type TemplateExtra } from './subject-builder'

export function buildBody(rule: BodyRule, group: MailGroup, customerName: string, signature: string, extra?: TemplateExtra): BuiltText {
  const values = templateValues(group.files, customerName, extra)
  const base = renderTemplate(rule.template, values)
  const supplement = renderTemplate(rule.supplement, values)
  const parts = [base.text.trim(), supplement.text.trim()].filter(Boolean)
  const signatureText = signature.trim()
  const joined = parts.join('\n\n')
  const withSignature = signatureText && !joined.includes(signatureText) ? `${joined}${joined ? '\n\n' : ''}${signatureText}` : joined
  return {
    text: withSignature,
    unresolved: [...base.unresolved, ...supplement.unresolved],
    needsConfirm: false
  }
}
