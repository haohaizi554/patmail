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
  const clip = text.length > 80 ? `${text.slice(0, 80)}…` : text
  if (text.includes('发明人')) return `处理细节要看发明人。表格里没有，到案件页发明人里核对。${clip}`.slice(0, 200)
  return `处理细节：${clip}`.slice(0, 200)
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
  volumes: string[]
  extra: number
  proc: string
  note: string
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
      if (found.volumes.length < 8) found.volumes.push(row.ourVolume)
      else found.extra += 1
      if (row.procLabel && !found.proc.split('、').includes(row.procLabel)) found.proc = `${found.proc}、${row.procLabel}`
      if (!found.note && row.iprNote?.trim()) found.note = row.iprNote.trim()
      continue
    }
    order.push(key)
    grouped.set(key, {
      customer: customer || '未写',
      volumes: [row.ourVolume],
      extra: 0,
      proc: row.procLabel,
      note: row.iprNote?.trim() || ''
    })
  }
  return order.flatMap(key => {
    const unit = grouped.get(key)
    return unit ? [unit] : []
  })
}

function waveMessage(units: readonly ArbitrationUnit[], index: number, total: number): string {
  const lines = units.map(unit => {
    const more = unit.extra ? `，另有 ${unit.extra} 件同一客户` : ''
    const note = unit.note || '处理细节里没有这一客户的原话。'
    return `- 客户 ${unit.customer}，先查我方文号 ${unit.volumes[0]}，同批文号 ${unit.volumes.join('、')}${more}。事项 ${unit.proc}。${note}`
  })
  return [
    `请仲裁收件人。这是第 ${index}/${total} 批，同一客户已经合并，只裁这一批。不要提交发文，不要创建发文任务，不要自己拼接口。`,
    '每一条只对给出的第一个我方文号调用一次 review_case_fields。结论覆盖这一条里的全部文号。只在返回的案件要求、发明人和案件页栏位里选定收件人和抄送。',
    '拿不准就 ask_user，把依据和你的判断一起给出来。裁完这一批就停，下一批会另外送来。',
    ...lines
  ].join('\n')
}

/** 空 IPR 按客户合并后再分批。一批一次交给本地模型，避免并发把模型打满。 */
export function iprArbitrationWaves(rows: readonly PctTaskRow[]): string[] {
  const units = arbitrationUnits(rows)
  const waves: ArbitrationUnit[][] = []
  let rest = units
  while (rest.length) {
    const size = arbitrationBatchSize(rest.map(unit => unit.note))
    waves.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  return waves.map((wave, index) => waveMessage(wave, index + 1, waves.length))
}

/** 上传给助手的仲裁说明。只带 IPR 仍空着的行，不带整张表。 */
export function iprArbitrationBrief(rows: readonly PctTaskRow[]): string {
  return iprArbitrationWaves(rows)[0] ?? ''
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
