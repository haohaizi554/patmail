import { isQueryGuid } from '../query/query-validator'
import { isRecord } from '../api/response-guards'

/** 发文页发件人下拉里的一项。显示方式和原站一样：名称<邮箱>。 */
export interface MailSender {
  id: string
  name: string
  email: string
  label: string
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
    items.push({ id: row.mailset_id, name: shownName, email, label: label.slice(0, 160) })
  }
  return items
}
