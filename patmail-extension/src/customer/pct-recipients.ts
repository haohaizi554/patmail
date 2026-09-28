import { isQueryGuid } from '../query/query-validator'
import type { PctTaskRow } from './types'
import type { MailContactRow } from '../mail/easy/mail-contacts'
import { appendRecipientField } from '../mail/easy/contracts'

const INVENTOR_ROLE = '第一发明人'

export interface PctRecipientPlan {
  to: string
  cc: string
  notes: string[]
}

function people(additions: Array<{ name: string; email: string }>): string {
  return additions.map(item => `${item.name}(${item.email});`).join('')
}

function compact(value: string): string {
  return value.replace(/\s/g, '')
}

function clean(row: MailContactRow): { name: string; email: string } | null {
  const name = row.name.trim()
  const email = row.email.trim()
  if (!name || !email.includes('@') || /[();；]/.test(name) || /[();；]/.test(email)) return null
  return { name, email }
}

function matchName(rows: MailContactRow[], name: string): MailContactRow[] {
  const wanted = compact(name)
  if (!wanted) return []
  return rows.filter(row => compact(row.name) === wanted && row.email.trim())
}

/** 当前发文页地址上的 objid。不在发文页时没有这封信。 */
export function currentMailId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!/\/mail\.aspx$/i.test(parsed.pathname)) return null
    const id = parsed.searchParams.get('objid') ?? ''
    return isQueryGuid(id) ? id : null
  } catch {
    return null
  }
}

/** 一对一：只用当前发文案件里出现的文号，对表格里的那几行。 */
export function sheetRowsOnMail(rows: PctTaskRow[], volumes: string[]): PctTaskRow[] {
  const keys = new Set(volumes.map(item => item.replace(/\s/g, '')).filter(Boolean))
  if (!keys.size) return []
  return rows.filter(row => keys.has(row.ourVolume.replace(/\s/g, '')) || keys.has(row.customerVolume.replace(/\s/g, '')))
}

/** 收件人是表格「第一客户联系人」，角色约定为第一发明人（技术联系人）。抄送是商务，再加上表格「客户联系人(IPR)」。 */
export function planPctRecipients(rows: PctTaskRow[], contacts: MailContactRow[], existing: { to: string; cc: string }): PctRecipientPlan {
  const notes: string[] = []
  const toAdded: Array<{ name: string; email: string }> = []
  const ccAdded: Array<{ name: string; email: string }> = []
  const seenTo = new Set<string>()
  const seenCc = new Set<string>()
  for (const name of [...new Set(rows.map(row => row.contactName.trim()).filter(Boolean))]) {
    const found = matchName(contacts, name)
    const inventors = found.filter(row => row.role.includes(INVENTOR_ROLE))
    const inventor = inventors.find(row => row.group === 'customer' || row.group === 'case') ?? inventors[0]
    const person = inventor ? clean(inventor) : null
    if (!person) {
      notes.push(found.length ? `「${name}」在联系人里没有可用的「${INVENTOR_ROLE}」邮箱，没有追加到收件人。` : `表格里的第一客户联系人「${name}」没有在发文联系人里对上邮箱。`)
      continue
    }
    const key = person.email.toLowerCase()
    if (seenTo.has(key)) continue
    seenTo.add(key)
    toAdded.push(person)
  }
  for (const row of contacts.filter(item => item.group === 'sales')) {
    const person = clean(row)
    if (!person) continue
    const key = person.email.toLowerCase()
    if (seenCc.has(key)) continue
    seenCc.add(key)
    ccAdded.push(person)
  }
  for (const name of [...new Set(rows.map(row => row.iprName.trim()).filter(Boolean))]) {
    const found = matchName(contacts, name)
    const ipr = found.find(row => row.group === 'pics' || /ipr|ip联系人/i.test(row.role)) ?? found[0]
    const person = ipr ? clean(ipr) : null
    if (!person) {
      notes.push(`表格里的客户联系人(IPR)「${name}」没有在发文联系人里对上邮箱。`)
      continue
    }
    const key = person.email.toLowerCase()
    if (seenCc.has(key)) continue
    seenCc.add(key)
    ccAdded.push(person)
  }
  return {
    to: appendRecipientField(existing.to, people(toAdded)),
    cc: appendRecipientField(existing.cc, people(ccAdded)),
    notes
  }
}
