import { isRecord } from '../../api/response-guards'
import { ruleParams } from './contracts'

/** GetMailInfo 里的 mail_bcc。键不存在或类型不对时不能当成空。 */
export function savedBcc(row: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, 'mail_bcc')) return null
  const value = row.mail_bcc
  if (typeof value === 'string') return value
  if (value === null) return ''
  return null
}

export function senderEmailOf(row: Record<string, unknown>): string {
  const value = row.SMTPFromEmail
  return typeof value === 'string' ? value.trim() : ''
}

/** 原站把裸邮箱存成「@ 前一段(邮箱);」。已经是「名称(邮箱)」或「名称<邮箱>」的沿用这个名称。 */
export function formatBccList(value: string): string {
  const parts: string[] = []
  for (const piece of value.split(/[;；]/)) {
    const text = piece.trim()
    if (!text) continue
    const angle = text.match(/^(.*)<([^<>]+@[^<>]+)>$/)
    const paren = text.match(/^(.*)\(([^()]+@[^()]+)\)$/)
    const email = (angle?.[2] ?? paren?.[2] ?? (text.includes('@') && !/[();<>]/.test(text) ? text : '')).trim()
    if (!email || /[();]/.test(email)) continue
    const named = (angle?.[1] ?? paren?.[1] ?? '').trim()
    const name = named || email.split('@')[0] || email
    if (!name || /[();]/.test(name)) continue
    parts.push(`${name}(${email});`)
  }
  return parts.join('')
}

/** 草稿里已有密送就原样保留。没有时用规则里的 blind_copy，规则也没有就密送发件邮箱。 */
export function resolveMailBcc(input: { saved: string; rule: string; senderEmail: string }): string {
  if (input.saved.trim()) return input.saved
  return formatBccList(input.rule) || formatBccList(input.senderEmail)
}

export function readBlindCopy(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.MailRuleInfo)) return ''
  return data.MailRuleInfo.flatMap(row => {
    if (!isRecord(row) || typeof row.blind_copy !== 'string') return []
    const text = row.blind_copy.trim()
    return text ? [text] : []
  }).join(';')
}

export async function mailBccToSave(
  row: Record<string, unknown>,
  mailId: string,
  customerId: string,
  post: (operation: 'getMailRule', params: URLSearchParams) => Promise<{ ok: boolean; data?: unknown }>
): Promise<string | null> {
  const saved = savedBcc(row)
  if (saved === null) return null
  if (saved.trim()) return saved
  const mailTypeId = typeof row.mail_type_id === 'string' ? row.mail_type_id : ''
  const mailTypeName = typeof row.mail_type === 'string' ? row.mail_type : ''
  const params = ruleParams({ mailId, customerId, mailTypeId, mailTypeName })
  let rule = ''
  if (params) {
    const result = await post('getMailRule', params)
    if (result.ok) rule = readBlindCopy(result.data)
  }
  return resolveMailBcc({ saved, rule, senderEmail: senderEmailOf(row) })
}
