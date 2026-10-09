import { isQueryGuid } from '../query/query-validator'
import { normalizeCustomerName } from './skills'
import type { PctTaskRow } from './types'
import type { MailContactRow } from '../mail/easy/mail-contacts'
import { appendRecipientField } from '../mail/easy/contracts'

const INVENTOR_ROLE = '第一发明人'

export type PctRecipientMode = 'ipr' | 'lead'

/** 表格里「名字(pinyin)」只留下名字，用来对发文联系人。邮箱列不参与。 */
export function sheetDisplayName(raw: string): string {
  return raw.trim().replace(/\s*[（(]\s*[A-Za-z][A-Za-z0-9._-]*\s*[）)]\s*$/, '').trim()
}

/** 工作流里用户写下的客户。这些客户按表格把第一发明人放进收件人、IPR 放进抄送。 */
export function inventorCustomers(raw: string): Set<string> {
  return new Set(raw.split(/[,，、;；\n\r]+/).map(normalizeCustomerName).filter(Boolean))
}

export function usesInventorSheet(customerName: string, specials: ReadonlySet<string>): boolean {
  return specials.has(normalizeCustomerName(customerName))
}

/** 补上的称呼在页面上带（补），仲裁出来的带（仲）。发给原网站和联系人匹配仍用原名。 */
export function carriedMark(name: string, carried: boolean | undefined): string {
  const text = name.trim()
  if (!text) return ''
  return carried ? `${text}（补）` : text
}

export function arbitratedMark(name: string, arbitrated: boolean | undefined): string {
  const text = name.trim()
  if (!text) return ''
  return arbitrated ? `${text}（仲）` : carriedMark(text, false)
}

function addressName(name: string, arbitrated: boolean | undefined): string {
  const text = name.trim()
  if (arbitrated && (text === '不用发' || text === '发明人')) return ''
  return text
}

/** 表格上这一行要写进这一封的称呼。默认收件人是 IPR，抄送留空，等发文页的商务。鹏城专案收件人是技术负责人，抄送先记下 IPR。 */
export function sheetRecipientNames(
  row: PctTaskRow,
  specials: ReadonlySet<string> = new Set(),
  mode: PctRecipientMode = 'ipr'
): { to: string; cc: string } {
  if (mode === 'lead') return { to: sheetDisplayName(row.leadName ?? ''), cc: addressName(row.iprName, row.iprArbitrated) }
  if (usesInventorSheet(row.customerName, specials)) return { to: row.contactName, cc: addressName(row.iprName, row.iprArbitrated) }
  return { to: addressName(row.iprName, row.iprArbitrated), cc: '' }
}

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
  const name = sheetDisplayName(row.name)
  const email = row.email.trim()
  if (!name || !email.includes('@') || /[();；]/.test(name) || /[();；]/.test(email)) return null
  return { name, email }
}

function matchName(rows: MailContactRow[], name: string): MailContactRow[] {
  const wanted = compact(sheetDisplayName(name))
  if (!wanted) return []
  return rows.filter(row => compact(sheetDisplayName(row.name)) === wanted && row.email.trim())
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

function pushPerson(
  bucket: Array<{ name: string; email: string }>,
  seen: Set<string>,
  person: { name: string; email: string } | null
): void {
  if (!person) return
  const key = person.email.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  bucket.push(person)
}

function inventorOf(contacts: MailContactRow[], name: string): { person: { name: string; email: string } | null; note: string } {
  const found = matchName(contacts, name)
  const inventors = found.filter(row => row.role.includes(INVENTOR_ROLE))
  const inventor = inventors.find(row => row.group === 'customer' || row.group === 'case') ?? inventors[0]
  const person = inventor ? clean(inventor) : null
  if (person) return { person, note: '' }
  return {
    person: null,
    note: found.length
      ? `「${name}」在联系人里没有可用的「${INVENTOR_ROLE}」邮箱，没有追加到收件人。`
      : `表格里的第一客户联系人「${name}」没有在发文联系人里对上邮箱。`
  }
}

function iprOf(contacts: MailContactRow[], name: string): { person: { name: string; email: string } | null; note: string } {
  const found = matchName(contacts, name)
  const ipr = found.find(row => row.group === 'pics' || /ipr|ip联系人/i.test(row.role)) ?? found[0]
  const person = ipr ? clean(ipr) : null
  if (person) return { person, note: '' }
  return { person: null, note: `表格里的客户联系人(IPR)「${name}」没有在发文联系人里对上邮箱。` }
}

function personByName(
  contacts: MailContactRow[],
  name: string,
  who: string
): { person: { name: string; email: string } | null; note: string } {
  const cleaned = sheetDisplayName(name)
  const people = matchName(contacts, cleaned).map(clean).filter((item): item is { name: string; email: string } => item !== null)
  const emails = [...new Set(people.map(item => item.email.toLowerCase()))]
  if (emails.length === 1) return { person: people.find(item => item.email.toLowerCase() === emails[0]) ?? null, note: '' }
  if (emails.length > 1) return { person: null, note: `「${cleaned}」对上了多个邮箱，没有追加到${who}。` }
  return { person: null, note: `表格里的${who}「${cleaned}」没有在发文联系人里对上邮箱。` }
}

/**
 * 一封信只有一组收件人和抄送。
 * 默认：收件人是表格里的 IPR，抄送是发文页的商务。
 * 鹏城专案：收件人是表格里的技术负责人，抄送是表格里的 IPR 和发文页的商务。
 * 用户在默认工作流里写下的客户：收件人是表格里的第一发明人，抄送是表格里的 IPR。
 */
export function planPctRecipients(
  rows: PctTaskRow[],
  contacts: MailContactRow[],
  existing: { to: string; cc: string },
  specials: ReadonlySet<string> = new Set(),
  mode: PctRecipientMode = 'ipr'
): PctRecipientPlan {
  const notes: string[] = []
  const toAdded: Array<{ name: string; email: string }> = []
  const ccAdded: Array<{ name: string; email: string }> = []
  const seenTo = new Set<string>()
  const seenCc = new Set<string>()
  if (mode === 'lead') {
    for (const name of [...new Set(rows.map(row => sheetDisplayName(row.leadName ?? '')).filter(Boolean))]) {
      const found = personByName(contacts, name, '技术负责人')
      if (found.note) notes.push(found.note)
      pushPerson(toAdded, seenTo, found.person)
    }
    for (const name of [...new Set(rows.map(row => row.iprName.trim()).filter(Boolean))]) {
      const found = iprOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(ccAdded, seenCc, found.person)
    }
    for (const row of contacts.filter(item => item.group === 'sales')) {
      pushPerson(ccAdded, seenCc, clean(row))
    }
    return {
      to: appendRecipientField(existing.to, people(toAdded)),
      cc: appendRecipientField(existing.cc, people(ccAdded)),
      notes
    }
  }
  const special = rows.some(row => usesInventorSheet(row.customerName, specials))
  const ordinary = rows.some(row => !usesInventorSheet(row.customerName, specials))
  if (special && ordinary) {
    return { to: existing.to, cc: existing.cc, notes: ['这几行不是同一套收件规则，没有改。请按客户拆开。'] }
  }
  if (special) {
    for (const name of [...new Set(rows.map(row => row.contactName.trim()).filter(Boolean))]) {
      const found = inventorOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(toAdded, seenTo, found.person)
    }
    for (const name of [...new Set(rows.map(row => row.iprName.trim()).filter(Boolean))]) {
      const found = iprOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(ccAdded, seenCc, found.person)
    }
  } else {
    for (const name of [...new Set(rows.map(row => row.iprName.trim()).filter(Boolean))]) {
      const found = iprOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(toAdded, seenTo, found.person)
    }
    for (const row of contacts.filter(item => item.group === 'sales')) {
      pushPerson(ccAdded, seenCc, clean(row))
    }
  }
  return {
    to: appendRecipientField(existing.to, people(toAdded)),
    cc: appendRecipientField(existing.cc, people(ccAdded)),
    notes
  }
}
