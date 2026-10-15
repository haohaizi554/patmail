import { isQueryGuid } from '../query/query-validator'
import { normalizeCustomerName } from './skills'
import type { PctTaskRow } from './types'
import type { MailContactRow } from '../mail/easy/mail-contacts'
import { appendRecipientField, type RuleMailPerson } from '../mail/easy/contracts'

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

/** 表格上这一行要写进这一封的称呼。默认收件人是 IPR（技术联系人），抄送留空，等发文页追加商务。仲裁只决定 IPR、发明人、客户联系人。鹏城专案收件人是技术负责人，抄送先记下 IPR。 */
export function sheetRecipientNames(
  row: PctTaskRow,
  specials: ReadonlySet<string> = new Set(),
  mode: PctRecipientMode = 'ipr'
): { to: string; cc: string } {
  const ipr = sheetDisplayName(row.iprName)
  if (row.iprArbitrated && ipr === '不用发') return { to: '不用发', cc: '' }
  if (row.iprArbitrated && ipr === '只发业务') return { to: '只发业务', cc: '' }
  if (mode !== 'lead' && row.iprArbitrated && addressName(row.iprName, true)) return { to: addressName(row.iprName, true), cc: (row.mailCc ?? '').trim() }
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

function splitCopyNames(raw: string): string[] {
  return raw.split(/[、,，;；]/).map(item => item.trim()).filter(item => item && !/^(无|空|没有|不抄送|拿不准)/.test(item))
}

function withSheetCopies(plan: PctRecipientPlan, rows: PctTaskRow[], contacts: MailContactRow[]): PctRecipientPlan {
  const names = [...new Set(rows.flatMap(row => splitCopyNames(row.mailCc ?? '')))]
  if (!names.length) return plan
  const added: Array<{ name: string; email: string }> = []
  const seen = new Set<string>()
  const notes = [...plan.notes]
  for (const name of names) {
    const found = personByName(contacts, name, '抄送')
    if (found.note) notes.push(found.note)
    pushPerson(added, seen, found.person)
  }
  if (!added.length) return { ...plan, notes }
  return { ...plan, cc: appendRecipientField(plan.cc, people(added)), notes }
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

function listedNames(raw: string): string[] {
  return [...new Set(raw.split(/[、,，;；]/).map(item => item.trim()).filter(item => item && !/^(无|空|没有|不抄送|拿不准|不用发|只发业务)$/.test(item)))]
}

/** 仲裁写回「发明人」指这一行表格里的第一客户联系人，只有人名能拿来对发文联系人。 */
function wantedNames(row: PctTaskRow): string[] {
  return listedNames(row.iprName).map(name => name === '发明人' ? row.contactName.trim() : name).filter(Boolean)
}

function addSales(
  contacts: MailContactRow[],
  bucket: Array<{ name: string; email: string }>,
  seen: Set<string>
): void {
  for (const row of contacts.filter(item => item.group === 'sales')) pushPerson(bucket, seen, clean(row))
}

/**
 * 一封信只有一组收件人和抄送。
 * 默认：收件人是表格里的 IPR（技术联系人），抄送追加发文页的商务。
 * 仲裁过的行：收件人是写回的人名，抄送是写回的额外抄送，商务仍追加，不因仲裁拿掉。
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
  if (rows.length && rows.every(row => row.iprArbitrated && sheetDisplayName(row.iprName) === '只发业务')) {
    addSales(contacts, toAdded, seenTo)
    addSales(contacts, ccAdded, seenCc)
    return withSheetCopies({
      to: appendRecipientField(existing.to, people(toAdded)),
      cc: appendRecipientField(existing.cc, people(ccAdded)),
      notes
    }, rows, contacts)
  }
  if (mode === 'lead') {
    for (const name of [...new Set(rows.map(row => sheetDisplayName(row.leadName ?? '')).filter(Boolean))]) {
      const found = personByName(contacts, name, '技术负责人')
      if (found.note) notes.push(found.note)
      pushPerson(toAdded, seenTo, found.person)
    }
    for (const name of [...new Set(rows.flatMap(row => listedNames(row.iprName).filter(item => item !== '发明人')))]) {
      const found = iprOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(ccAdded, seenCc, found.person)
    }
    addSales(contacts, ccAdded, seenCc)
    return withSheetCopies({
      to: appendRecipientField(existing.to, people(toAdded)),
      cc: appendRecipientField(existing.cc, people(ccAdded)),
      notes
    }, rows, contacts)
  }
  const arbitrated = rows.filter(row => row.iprArbitrated)
  if (arbitrated.length) {
    if (arbitrated.length !== rows.length) {
      return { to: existing.to, cc: existing.cc, notes: ['这几行里有的按仲裁、有的按原表，没有改。请拆开。'] }
    }
    for (const name of [...new Set(rows.flatMap(row => wantedNames(row)))]) {
      const found = personByName(contacts, name, '收件人')
      if (found.note) notes.push(found.note)
      pushPerson(toAdded, seenTo, found.person)
    }
    addSales(contacts, ccAdded, seenCc)
    return withSheetCopies({
      to: appendRecipientField(existing.to, people(toAdded)),
      cc: appendRecipientField(existing.cc, people(ccAdded)),
      notes
    }, rows, contacts)
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
    for (const name of [...new Set(rows.flatMap(row => listedNames(row.iprName)))]) {
      const found = iprOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(ccAdded, seenCc, found.person)
    }
  } else {
    for (const name of [...new Set(rows.flatMap(row => listedNames(row.iprName)))]) {
      const found = iprOf(contacts, name)
      if (found.note) notes.push(found.note)
      pushPerson(toAdded, seenTo, found.person)
    }
    addSales(contacts, ccAdded, seenCc)
  }
  return withSheetCopies({
    to: appendRecipientField(existing.to, people(toAdded)),
    cc: appendRecipientField(existing.cc, people(ccAdded)),
    notes
  }, rows, contacts)
}

/** 发文页勾选时会去掉名称里的第一对括号。杨智银（流程）写成杨智银流程。 */
function ruleContactName(raw: string): string {
  return raw.trim().replace('(', '').replace(')', '').replace('（', '').replace('）', '').trim()
}

function ruleAddress(person: RuleMailPerson): { name: string; email: string } | null {
  const name = ruleContactName(person.name)
  const email = person.email.trim()
  const at = email.indexOf('@')
  if (!name || at <= 0 || at !== email.lastIndexOf('@') || !email.slice(at + 1).includes('.')) return null
  if (/[();；<>\s/]/.test(name) || /[();；<>\s/]/.test(email)) return null
  return { name, email }
}

/** 缺 IPR 时按这封发文规则里 type=to 的客户联系人写收件人，业务人员仍全部抄送。已有收件人换成这批人。邮箱不是地址的人不写。 */
export function planCheckedRecipients(
  rulePeople: RuleMailPerson[],
  contacts: MailContactRow[],
  existing: { to: string; cc: string }
): PctRecipientPlan & { skipped: string[] } {
  const toAdded: Array<{ name: string; email: string }> = []
  const ccAdded: Array<{ name: string; email: string }> = []
  const seenTo = new Set<string>()
  const seenCc = new Set<string>()
  const notes: string[] = []
  const skipped: string[] = []
  for (const person of rulePeople) {
    if (person.type.trim().toLowerCase() !== 'to') continue
    const address = ruleAddress(person)
    if (!address) {
      const label = ruleContactName(person.name) || person.name.trim()
      if (label) skipped.push(label)
      continue
    }
    pushPerson(toAdded, seenTo, address)
  }
  for (const row of contacts.filter(item => item.group === 'sales')) pushPerson(ccAdded, seenCc, clean(row))
  if (!toAdded.length) notes.push('发文规则里没有可勾选的客户联系人邮箱，没有提交。')
  if (!ccAdded.length) notes.push('发文页没有可勾选的业务人员邮箱，没有提交。')
  return {
    to: people(toAdded),
    cc: appendRecipientField(existing.cc, people(ccAdded)),
    notes,
    skipped
  }
}
