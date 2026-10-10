import { pctRowsFromTable } from './pct-sheet'
import { sheetDisplayName } from './pct-recipients'
import type { PctRuntimeConfig } from '../workflow/pct-config'
import type { PctTaskRow } from './types'
import type { XlsxSheet } from './xlsx-table'

export interface PctWorkbookRead {
  rows: PctTaskRow[]
  notice: string
  /** 补完上一行之后 IPR 仍是空的。交给助手仲裁。 */
  gaps: PctTaskRow[]
}

function isDetailSheet(name: string): boolean {
  return name.includes('处理细节')
}

function isNationalSheet(name: string): boolean {
  return name.includes('进国家')
}

function isRemindSheet(name: string): boolean {
  return name.includes('提醒申请PCT') && !isDetailSheet(name)
}

/** 导入时只解开这几张。期限监控和图片不读，避免大表把页面卡住。对不上名字时仍读第一张。 */
export function isPctWorkbookSheet(name: string): boolean {
  return isRemindSheet(name) || isNationalSheet(name) || isDetailSheet(name)
}

function shortCustomer(name: string): string {
  let text = name.trim()
  const suffixes = ['股份有限公司', '有限责任公司', '有限公司', '股份', '集团']
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of suffixes) {
      if (text.endsWith(suffix) && text.length - suffix.length >= 2) {
        text = text.slice(0, -suffix.length)
        changed = true
      }
    }
  }
  return text
}

/** 处理细节表里的原话。图片公式和纯数字不拿来对客户。 */
export function detailLines(table: string[][]): string[] {
  const lines: string[] = []
  for (const row of table) {
    const text = row
      .map(cell => cell.trim())
      .filter(cell => cell && !cell.startsWith('=DISPIMG') && !/^\d+(\.\d+)?$/.test(cell))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) lines.push(text.slice(0, 500))
  }
  return lines
}

function nameHits(token: string, key: string): boolean {
  const cleaned = token.replace(/不用发/g, '').replace(/[（(].*$/, '').trim()
  return cleaned.split(/[-—]/).map(shortCustomer).some(name => name.length >= 2 && (name === key || key.startsWith(name) || name.startsWith(key)))
}

function headMention(text: string, head: string): boolean {
  let from = 0
  while (from <= text.length - head.length) {
    const at = text.indexOf(head, from)
    if (at < 0) return false
    const before = at === 0 ? '' : text[at - 1] ?? ''
    const rest = text.slice(at + head.length)
    const boundaryBefore = at === 0 || /[\s，,、。；;：:（(]/.test(before)
    const boundaryAfter = rest === '' || /^[\s，,、。；;：:（()）]/.test(rest) || /^(?:提醒|收件|主送|不用)/.test(rest)
    if (boundaryBefore && boundaryAfter) return true
    from = at + head.length
  }
  return false
}

function mentionsCustomer(text: string, key: string): boolean {
  if (key.length < 2) return false
  if (text.includes(key)) return true
  if (text.split(/[、,，]/).some(piece => nameHits(piece, key))) return true
  const longest = Math.min(key.length - 1, 4)
  for (let size = longest; size >= 2; size -= 1) {
    if (headMention(text, key.slice(0, size))) return true
  }
  return false
}

function ownBits(line: string, key: string): string[] {
  return line.split(/[。；;\n]/).flatMap(sentence => sentence.split(/[，,]/)).map(bit => bit.trim()).filter(bit => mentionsCustomer(bit, key))
}

function cleanPerson(raw: string): string {
  const text = sheetDisplayName(raw.replace(/<[^>]*>/g, '').replace(/@[^\s]+/g, '')).replace(/\s*[（(][^）)]{1,12}[）)]\s*$/, '').trim()
  if (!text || text.length > 12) return ''
  if (/不用发|处理细节|每个月|统一|IPR|商务|主送|抄送|提醒/.test(text)) return ''
  return text
}

function personIn(bit: string): string {
  const match = bit.match(/(?:收件人|主送)\s*[:：]\s*([^\s<,，;；、]{1,20})/)
  return match ? cleanPerson(match[1]) : ''
}

function inventorFor(line: string, key: string): boolean {
  return line.split(/[。；;\n]/).some(sentence => {
    if (!sentence.includes('发明人') || !mentionsCustomer(sentence, key)) return false
    const bits = sentence.split(/[，,]/).map(bit => bit.trim())
    return bits.some((bit, index) => {
      if (!bit.includes('发明人')) return false
      const near = bits.slice(Math.max(0, index - 1), index + 1).join('')
      return mentionsCustomer(bit, key) || mentionsCustomer(near, key)
    })
  })
}

function skipped(line: string, key: string): boolean {
  return line.split(/[。；;\n]/).some(sentence => {
    if (!sentence.includes('不用发')) return false
    const bit = sentence.split(/[，,]/).find(item => item.includes('不用发')) ?? ''
    return mentionsCustomer(bit, key)
  })
}

/** 从处理细节里只取出裁决：人名、不用发，或发明人。拿不准就留空，不把原话塞进收件人。 */
export function arbitrateDetail(customerName: string, lines: readonly string[]): string {
  const key = shortCustomer(customerName)
  if (key.length < 2) return ''
  const hits = lines.filter(line => mentionsCustomer(line, key))
  for (const line of hits) {
    for (const bit of ownBits(line, key)) {
      const person = personIn(bit)
      if (person) return person
    }
  }
  if (hits.some(line => skipped(line, key))) return '不用发'
  if (hits.some(line => inventorFor(line, key))) return '发明人'
  return ''
}

export function noteForBlankIpr(customerName: string, lines: readonly string[]): string {
  const key = shortCustomer(customerName)
  const hits = key.length >= 2 ? lines.filter(line => line.includes(key)).slice(0, 2) : []
  if (!hits.length) return '上一行也没有 IPR。要到案件要求里核对，拿不准交给助手仲裁。'
  const text = hits.join(' ')
  const clip = text.length > 600 ? `${text.slice(0, 600)}…` : text
  if (text.includes('发明人')) return `处理细节要看发明人。表格里没有，到案件页发明人里核对。${clip}`.slice(0, 800)
  return `处理细节：${clip}`.slice(0, 800)
}

function withDetailNotes(rows: PctTaskRow[], lines: readonly string[]): PctTaskRow[] {
  return rows.map(row => {
    if (row.iprName.trim()) return row
    const decided = arbitrateDetail(row.customerName, lines)
    if (decided) return { ...row, iprName: decided, iprArbitrated: true as const }
    return { ...row, iprNote: noteForBlankIpr(row.customerName, lines) }
  })
}

/**
 * 一次读提醒申请 PCT 和进国家两张表。
 * 没有这两张名字时，仍只读第一张，跟以前的单表一样。
 * 处理细节不进发文行，只用来给空着的 IPR 摘一句。
 */
export function pctRowsFromWorkbook(
  sheets: XlsxSheet[],
  mailTypes: Array<{ id: string; name: string }> = [],
  config?: PctRuntimeConfig
): PctWorkbookRead {
  const detail = sheets.find(sheet => isDetailSheet(sheet.name))
  const namedRemind = sheets.filter(sheet => isRemindSheet(sheet.name))
  const namedNational = sheets.filter(sheet => isNationalSheet(sheet.name))
  const named = namedRemind.length + namedNational.length > 0
  const remindSheets = named ? namedRemind : sheets.filter(sheet => !isDetailSheet(sheet.name)).slice(0, 1)
  const nationalSheets = named ? namedNational : []
  const parts = [
    ...remindSheets.map(sheet => pctRowsFromTable(sheet.rows, mailTypes, config, 'remind')),
    ...nationalSheets.map(sheet => pctRowsFromTable(sheet.rows, mailTypes, config, 'national'))
  ]
  const merged = parts.flatMap(part => part.rows).slice(0, 5000)
  const noted = withDetailNotes(merged, detail ? detailLines(detail.rows) : [])
  const gaps = noted.filter(row => !row.iprName.trim())
  const decided = noted.filter(row => row.iprArbitrated).length
  const remindCount = noted.filter(row => row.letterKind !== 'national' && row.letterKind !== 'design').length
  const nationalCount = noted.filter(row => row.letterKind === 'national' || row.letterKind === 'design').length
  const notice = [
    named ? `提醒申请 PCT ${remindCount} 行，进国家 ${nationalCount} 行。` : '',
    parts.map(part => part.notice).filter(Boolean).join(''),
    gaps.length ? `${gaps.length} 行 IPR 仍是空的，可以交给助手。` : '',
    decided ? `处理细节裁了 ${decided} 行，收件人后面标（仲）。` : ''
  ].filter(Boolean).join('')
  return { rows: noted, notice, gaps }
}

/** 本地模型一轮能扛住的仲裁条数。原文越长、剩下越多，一次越少。 */
export function arbitrationBatchSize(notes: readonly string[]): number {
  const count = notes.length
  if (count <= 1) return count
  const longest = notes.reduce((max, note) => Math.max(max, note.trim().length), 0)
  let size = longest >= 120 ? 1 : longest >= 40 ? 2 : 3
  if (count >= 40) size = Math.min(size, 2)
  if (count >= 80) size = 1
  return Math.min(size, count)
}

interface ArbitrationUnit {
  customer: string
  rows: PctTaskRow[]
  note: string
}

function sheetFieldLine(row: PctTaskRow): string {
  const fields = [
    `我方文号 ${row.ourVolume.trim() || '空'}`,
    `客户文号 ${row.customerVolume.trim() || '空'}`,
    `客户名称 ${row.customerName.trim() || '空'}`,
    `第一客户联系人 ${row.contactName.trim() || '空'}`,
    `IPR ${row.iprName.trim() || '空'}`,
    ...(row.leadName?.trim() ? [`技术负责人 ${row.leadName.trim()}`] : []),
    `处理事项 ${row.procLabel.trim() || '空'}`,
    `发文类型 ${row.mailTypeLabel.trim() || '空'}`,
    `处理细节 ${row.iprNote?.trim() || '没有'}`
  ]
  return fields.join('，')
}

function clipDemand(text: string | undefined): string {
  const clean = text?.trim() ?? ''
  if (!clean) return '插件没有读到这位客户的客户信息。'
  return clean.length > 2000 ? `${clean.slice(0, 2000)}…` : clean
}

function clipCase(text: string | undefined): string {
  const clean = text?.trim() ?? ''
  if (!clean) return '著录项目：这一文号没有读到。'
  const body = clean.length > 1500 ? `${clean.slice(0, 1500)}…` : clean
  return `著录项目：\n${body}`
}

function arbitrationUnits(rows: readonly PctTaskRow[]): ArbitrationUnit[] {
  const order: string[] = []
  const grouped = new Map<string, ArbitrationUnit>()
  for (const row of rows) {
    if (row.iprName.trim()) continue
    const customer = row.customerName.trim()
    const key = customer || `行:${row.ourVolume}`
    const found = grouped.get(key)
    if (found) {
      found.rows.push(row)
      if (!found.note && row.iprNote?.trim()) found.note = row.iprNote.trim()
      continue
    }
    order.push(key)
    grouped.set(key, { customer: customer || '未写', rows: [row], note: row.iprNote?.trim() || '' })
  }
  return order.flatMap(key => {
    const unit = grouped.get(key)
    return unit ? [unit] : []
  })
}

function unitBlock(unit: ArbitrationUnit, demands: Readonly<Record<string, string>>, cases: Readonly<Record<string, string>>): string {
  const lines = unit.rows.map(row => {
    const volume = row.ourVolume.trim() || row.customerVolume.trim()
    return `- ${sheetFieldLine(row)}\n${clipCase(cases[volume])}`
  })
  return [`客户 ${unit.customer}`, `客户信息：\n${clipDemand(demands[unit.customer])}`, '表格字段：', ...lines].join('\n')
}

function splitOversized(unit: ArbitrationUnit, demands: Readonly<Record<string, string>>, cases: Readonly<Record<string, string>>): ArbitrationUnit[] {
  if (unitBlock(unit, demands, cases).length <= 9000) return [unit]
  const pieces: ArbitrationUnit[] = []
  let bucket: PctTaskRow[] = []
  for (const row of unit.rows) {
    const next = unitBlock({ ...unit, rows: [...bucket, row] }, demands, cases)
    if (bucket.length && next.length > 9000) {
      pieces.push({ ...unit, rows: bucket })
      bucket = [row]
    } else {
      bucket.push(row)
    }
  }
  if (bucket.length) pieces.push({ ...unit, rows: bucket })
  return pieces
}

function waveMessage(units: readonly ArbitrationUnit[], index: number, total: number, demands: Readonly<Record<string, string>>, cases: Readonly<Record<string, string>>): string {
  const blocks = units.map(unit => unitBlock(unit, demands, cases))
  const text = [
    `请仲裁收件人。这是第 ${index}/${total} 批。材料只有下面这些文字：每一行的表格字段，以及插件自己接口读到的客户要求和著录项目。`,
    '每一行单独裁。第一客户联系人不同的，不能收成同一个人，也不能用一条结论盖住同客户的全部文号。',
    '收件人、抄送都要写清是谁，以及身份。身份只能是：发明人、客户联系人、IPR、技术负责人、商务、不用发。多人用顿号，身份与人名一一对应。',
    '每一行只写一行，用竖线分开，文号原样照抄：',
    '文号 <我方文号>｜收件人 <人名，多人顿号>｜身份 <身份，多人顿号>｜抄送 <人名或无>｜抄送身份 <身份或无>｜依据 <一句话>',
    '拿不准的行写成：文号 <我方文号>｜拿不准｜依据 <一句话>。不要把身份写进人名括号。',
    '不要调用工具，不要构造接口，不要自己去查，不要创建任务，不要让用户挑选。裁完这一批就停。',
    ...blocks
  ].join('\n\n')
  return text.length > 18000 ? `${text.slice(0, 18000)}\n（后面的原文被截断了。）` : text
}

/** 空 IPR 按客户合并后再分批。一批一次交给本地模型。客户信息和著录项目由插件先读好，写进原文。 */
export function iprArbitrationWaves(
  rows: readonly PctTaskRow[],
  demands: Readonly<Record<string, string>> = {},
  cases: Readonly<Record<string, string>> = {}
): string[] {
  const units = arbitrationUnits(rows).flatMap(unit => splitOversized(unit, demands, cases))
  const waves: ArbitrationUnit[][] = []
  let rest = units
  while (rest.length) {
    const size = arbitrationBatchSize(rest.map(unit => unit.note))
    waves.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  return waves.map((wave, index) => waveMessage(wave, index + 1, waves.length, demands, cases))
}

/** 上传给助手的仲裁说明。只带 IPR 仍空着、并且接口已经读到材料的行。 */
export function iprArbitrationBrief(
  rows: readonly PctTaskRow[],
  demands: Readonly<Record<string, string>> = {},
  cases: Readonly<Record<string, string>> = {}
): string {
  return iprArbitrationWaves(rows, demands, cases)[0] ?? ''
}

function volumeKey(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

export interface ArbitrationDecision {
  volume: string
  recipient: string
  role: string
  cc: string
  ccRole: string
  reason: string
  unsure: boolean
}

const ROLE_WORDS = ['发明人', '客户联系人', 'IPR', '技术负责人', '商务', '不用发']

function blankParty(value: string): boolean {
  return !value || /^(无|空|没有|不抄送|拿不准)/.test(value)
}

function partyText(value: string): string {
  const names = value.split(/[、,，]/).map(part => part.replace(/[（(][^）)]{1,12}[）)]/g, '').trim()).filter(part => part && !blankParty(part))
  return names.join('、').slice(0, 80)
}

function roleText(value: string, fallback: string): string {
  const picked = value.split(/[、,，]/).map(part => part.trim()).filter(part => ROLE_WORDS.includes(part))
  if (picked.length) return picked.join('、')
  const marked = fallback.match(/[（(]([^）)]+)[）)]/g)?.map(part => part.replace(/[（()）]/g, '').trim()).filter(part => ROLE_WORDS.includes(part)) ?? []
  return marked.join('、')
}

function fieldOf(parts: string[], label: string): string {
  const found = parts.find(part => part === label || part.startsWith(`${label} `) || part.startsWith(`${label}：`) || part.startsWith(`${label}:`))
  if (!found || found === label) return ''
  return found.slice(label.length).replace(/^[：:\s]+/, '').trim()
}

/** 从助手回复里取出每一行的收件人、身份和抄送。拿不准的也留下，但不写进表格。 */
export function readArbitrationDecisions(text: string): ArbitrationDecision[] {
  const decisions: ArbitrationDecision[] = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim()
    const volume = line.match(/文号\s*[｜|:：]?\s*([A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._-]{1,80})/)
    if (!volume?.[1]) continue
    const parts = line.split(/[｜|]/).map(part => part.trim())
    const unsure = parts.some(part => part === '拿不准' || part.startsWith('拿不准')) || /[：:]\s*拿不准/.test(line)
    const reason = fieldOf(parts, '依据').slice(0, 120)
    if (unsure) {
      decisions.push({ volume: volume[1], recipient: '', role: '', cc: '', ccRole: '', reason, unsure: true })
      continue
    }
    const recipientRaw = fieldOf(parts, '收件人') || line.match(/收件人\s*[：:\-]?\s*([^，,；;｜|\n]+)/)?.[1]?.trim() || ''
    const ccRaw = fieldOf(parts, '抄送') || line.match(/抄送\s*[：:\-]?\s*([^，,；;｜|\n]+)/)?.[1]?.trim() || ''
    const recipient = partyText(recipientRaw)
    if (!recipient) continue
    decisions.push({
      volume: volume[1],
      recipient,
      role: roleText(fieldOf(parts, '身份'), recipientRaw),
      cc: partyText(ccRaw),
      ccRole: roleText(fieldOf(parts, '抄送身份'), ccRaw),
      reason,
      unsure: false
    })
  }
  return decisions
}

/** 按文号把收件人写回表格。拿不准的不填。 */
export function applyArbitrationReply(rows: readonly PctTaskRow[], text: string): { rows: PctTaskRow[]; written: number; unsure: number; decisions: ArbitrationDecision[] } {
  const decisions = readArbitrationDecisions(text)
  const byVolume = new Map(decisions.filter(item => !item.unsure).map(item => [volumeKey(item.volume), item]))
  let written = 0
  const next = rows.map(row => {
    const write = byVolume.get(volumeKey(row.ourVolume)) || (row.customerVolume ? byVolume.get(volumeKey(row.customerVolume)) : undefined)
    if (!write) return row
    written += 1
    const { iprCarried: _carried, ...rest } = row
    return {
      ...rest,
      iprName: write.recipient,
      iprArbitrated: true as const,
      ...(write.cc ? { mailCc: write.cc } : {})
    }
  })
  return { rows: next, written, unsure: decisions.filter(item => item.unsure).length, decisions }
}

/** 查不到的行，按源表的列拆回两张表。沿用上一行或仲裁填上的称呼不写回去。 */
export function missedSourceSheets(
  rows: readonly PctTaskRow[],
  verdict: (row: PctTaskRow) => string,
  columns: PctRuntimeConfig['columns']
): Array<{ name: string; rows: string[][] }> {
  const header = [
    columns.ourVolume,
    columns.customerVolume,
    columns.customerName,
    columns.contactName,
    columns.iprName,
    ...(columns.leadName ? [columns.leadName] : []),
    columns.procLabel,
    '查询结果'
  ]
  const remind: string[][] = [header]
  const national: string[][] = [header]
  for (const row of rows) {
    const result = verdict(row)
    if (result !== '库里没有' && result !== '没查成') continue
    const line = [
      row.ourVolume,
      row.customerVolume,
      row.customerName,
      row.contactCarried ? '' : row.contactName,
      row.iprCarried || row.iprArbitrated ? '' : row.iprName,
      ...(columns.leadName ? [row.leadCarried ? '' : (row.leadName ?? '')] : []),
      row.procLabel,
      result
    ]
    const target = row.letterKind === 'national' || row.letterKind === 'design' ? national : remind
    target.push(line)
  }
  return [
    remind.length > 1 ? { name: '提醒申请PCT', rows: remind } : null,
    national.length > 1 ? { name: 'PCT进国家阶段官方绝限', rows: national } : null
  ].filter((item): item is { name: string; rows: string[][] } => item !== null)
}

/** 核对完的整张表。列跟上传的一样，末尾多一列审核状态。 */
export function checkedSourceSheets(
  rows: readonly PctTaskRow[],
  statusOf: (row: PctTaskRow) => string,
  columns: PctRuntimeConfig['columns']
): Array<{ name: string; rows: string[][] }> {
  const header = [
    columns.ourVolume,
    columns.customerVolume,
    columns.customerName,
    columns.contactName,
    columns.iprName,
    ...(columns.leadName ? [columns.leadName] : []),
    columns.procLabel,
    '审核状态'
  ]
  const remind: string[][] = [header]
  const national: string[][] = [header]
  for (const row of rows) {
    const line = [
      row.ourVolume,
      row.customerVolume,
      row.customerName,
      row.contactName,
      row.iprName,
      ...(columns.leadName ? [row.leadName ?? ''] : []),
      row.procLabel,
      statusOf(row)
    ]
    const target = row.letterKind === 'national' || row.letterKind === 'design' ? national : remind
    target.push(line)
  }
  return [
    remind.length > 1 ? { name: '提醒申请PCT', rows: remind } : null,
    national.length > 1 ? { name: 'PCT进国家阶段官方绝限', rows: national } : null
  ].filter((item): item is { name: string; rows: string[][] } => item !== null)
}
