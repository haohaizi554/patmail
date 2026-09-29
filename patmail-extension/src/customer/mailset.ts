import { isQueryGuid } from '../query/query-validator'
import { isRecord } from '../api/response-guards'
import { signaturePlainText } from '../mail/easy/signature-read'

/** 发文页发件人下拉里的一项。显示方式和原站一样：名称<邮箱>。 */
export interface MailSender {
  id: string
  name: string
  email: string
  label: string
  /** 个人设置里标成默认的那一条。签名挂在登录账号的这条邮件设置上。 */
  isDefault: boolean
  isPublic: boolean
  /** MailinfoInit 带回的预存签名。没有就是空字符串。 */
  signature: string
}

export function readMailSenders(data: unknown): MailSender[] {
  if (!isRecord(data) || !Array.isArray(data.mailsettinglist)) return []
  const items: MailSender[] = []
  for (const row of data.mailsettinglist) {
    if (!isRecord(row) || typeof row.mailset_id !== 'string' || !isQueryGuid(row.mailset_id)) continue
    const name = typeof row.cn_name === 'string' ? row.cn_name.trim() : ''
    const smtp = typeof row.SMTPFromEmail === 'string' ? row.SMTPFromEmail.trim() : ''
    const exchange = typeof row.exchange_email === 'string' ? row.exchange_email.trim() : ''
    const email = smtp || exchange
    if (!name && !email) continue
    const shownName = name || email
    const label = email ? `${shownName}<${email}>` : shownName
    if (items.some(item => item.id === row.mailset_id)) continue
    const rawSignature = typeof row.Signature === 'string' ? signaturePlainText(row.Signature) : ''
    items.push({
      id: row.mailset_id,
      name: shownName,
      email,
      label: label.slice(0, 160),
      isDefault: flagged(row, 'is_default'),
      isPublic: flagged(row, 'is_public'),
      signature: rawSignature
    })
  }
  return items
}

function flagged(row: Record<string, unknown>, key: string): boolean {
  const value = row[key]
  return value === true || value === 1 || value === '1' || value === 'true'
}

/** 当前登录账号在个人设置里预存的那条邮件设置。没有唯一默认项时不猜。 */
export function accountMailset<T extends { isDefault: boolean }>(items: T[]): T | null {
  const defaults = items.filter(item => item.isDefault)
  if (defaults.length === 1) return defaults[0]
  if (items.length === 1 && defaults.length === 0) return items[0]
  return null
}
