import type { CustomerQueryProfile } from '../customer/types'
import { resolveMailType } from './rules/description-mapping'
import { resolveRecipients } from './rules/recipient-resolver'
import { renderTemplate } from './rules/subject-builder'
import type { MailGroup, MailRuleBundle, SelectedPatentFile } from './types'

export interface AssembledMail {
  customerName: string
  customerId: string
  mailTypeId: string
  mailTypeName: string
  fileNames: string[]
  to: string
  cc: string
  subject: string
  body: string
  reviewerId: string
  reviewerName: string
  gaps: string[]
}

export interface RuleFill {
  to: string
  cc: string
  subject: string
  body: string
  mailTypeId: string
  mailTypeName: string
  notes: string[]
}

function valuesOf(customerName: string, files: SelectedPatentFile[]): Record<string, string> {
  return {
    文件名称: files.map(file => file.fileName.trim()).filter(Boolean).join('、'),
    客户名称: customerName.trim(),
    我方文号: files.map(file => file.caseVolume?.trim() ?? '').filter(Boolean).join('、'),
    申请号: files.map(file => file.applicationNo?.trim() ?? '').filter(Boolean).join('、'),
    文件数量: String(files.length)
  }
}

function groupFor(file: SelectedPatentFile, customerProfileId: string): MailGroup {
  const description = file.fileDescriptionId?.trim()
    ? `id:${file.fileDescriptionId.trim()}`
    : file.fileDescription.trim() ? `text:${file.fileDescription.trim()}` : ''
  return {
    id: file.fileId,
    customerProfileId,
    customerIdentity: customerProfileId,
    descriptionIdentity: description,
    descriptionLabel: file.fileDescription.trim(),
    sendMode: 'single_file',
    files: [file],
    policyVersion: 0
  }
}

/** 把已保存规则里的收件人、标题、正文和发文类型带进来，用户还可以改。 */
export function fillFromRules(customer: CustomerQueryProfile, files: SelectedPatentFile[], rules: MailRuleBundle | null, operatorId: string): RuleFill {
  const notes: string[] = []
  const recipient = rules ? resolveRecipients(customer.id, rules.recipients) : null
  if (!recipient) notes.push('这个客户还没有收件人规则，收件人需要自己填。')
  const values = valuesOf(customer.name, files)
  const subject = rules ? renderTemplate(rules.subject.template, values) : { text: '', unresolved: [] as string[] }
  const bodyBase = rules ? renderTemplate(rules.body.template, values) : { text: '', unresolved: [] as string[] }
  const extra = rules ? renderTemplate(rules.body.supplement, values) : { text: '', unresolved: [] as string[] }
  if (!rules?.subject.template.trim()) notes.push('还没有标题模板。')
  for (const name of [...subject.unresolved, ...bodyBase.unresolved, ...extra.unresolved]) {
    if (!notes.some(item => item.includes(name))) notes.push(`模板里的 {${name}} 还没有对应内容。`)
  }
  const signature = rules?.signatures.find(item => item.enabled && item.isDefault && item.operatorId === operatorId)?.content.trim() ?? ''
  const bodyText = [bodyBase.text.trim(), extra.text.trim()].filter(Boolean).join('\n\n')
  const body = signature && !bodyText.includes(signature) ? `${bodyText}${bodyText ? '\n\n' : ''}${signature}` : bodyText
  const matched = new Map<string, string>()
  if (rules) {
    for (const file of files) {
      const resolved = resolveMailType(groupFor(file, customer.id), rules.mappings)
      if (resolved.conflict) notes.push(`${file.fileName || '文件'} 的描述对应了多个发文类型。`)
      else if (resolved.mapping) matched.set(resolved.mapping.mailTypeId, resolved.mapping.mailTypeName)
    }
  }
  if (matched.size > 1) notes.push('所选文件对应了多个发文类型，请自己选一个。')
  const [mailTypeId, mailTypeName] = matched.size === 1 ? [...matched.entries()][0] : ['', '']
  return {
    to: recipient ? recipient.to.join(';') : '',
    cc: recipient ? recipient.cc.join(';') : '',
    subject: subject.text,
    body,
    mailTypeId,
    mailTypeName,
    notes
  }
}

/** 用户自己选定的资源拼成一封预览。这里不调用创建发文接口。 */
export function assembleMail(input: {
  customer: CustomerQueryProfile | null
  mailTypeId: string
  mailTypeName: string
  files: SelectedPatentFile[]
  to: string
  cc: string
  subject: string
  body: string
  reviewer?: { userId: string; name: string } | null
}): AssembledMail {
  const gaps: string[] = []
  if (!input.customer) gaps.push('还没有选择客户。')
  if (!input.mailTypeId.trim() || !input.mailTypeName.trim()) gaps.push('还没有选择发文类型。')
  if (input.files.length === 0) gaps.push('还没有选择文件。')
  if (!input.to.trim()) gaps.push('还没有收件人。')
  if (!input.subject.trim()) gaps.push('还没有主题。')
  if (!input.reviewer?.userId || !input.reviewer.name.trim()) gaps.push('还没有默认审核人。')
  return {
    customerName: input.customer?.name ?? '',
    customerId: input.customer?.easyCustomerId?.trim() ?? '',
    mailTypeId: input.mailTypeId.trim(),
    mailTypeName: input.mailTypeName.trim(),
    fileNames: input.files.map(file => file.fileName.trim()).filter(Boolean),
    to: input.to.trim(),
    cc: input.cc.trim(),
    subject: input.subject.trim(),
    body: input.body.trim(),
    reviewerId: input.reviewer?.userId ?? '',
    reviewerName: input.reviewer?.name.trim() ?? '',
    gaps
  }
}
