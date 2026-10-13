import { pctRowsFromTable, type CarryMode } from './pct-sheet'
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
  config?: PctRuntimeConfig,
  carry: CarryMode = 'block'
): PctWorkbookRead {
  const detail = sheets.find(sheet => isDetailSheet(sheet.name))
  const namedRemind = sheets.filter(sheet => isRemindSheet(sheet.name))
  const namedNational = sheets.filter(sheet => isNationalSheet(sheet.name))
  const named = namedRemind.length + namedNational.length > 0
  const remindSheets = named ? namedRemind : sheets.filter(sheet => !isDetailSheet(sheet.name)).slice(0, 1)
  const nationalSheets = named ? namedNational : []
  const parts = [
    ...remindSheets.map(sheet => pctRowsFromTable(sheet.rows, mailTypes, config, 'remind', carry)),
    ...nationalSheets.map(sheet => pctRowsFromTable(sheet.rows, mailTypes, config, 'national', carry))
  ]
  const merged = parts.flatMap(part => part.rows).slice(0, 5000)
  const noted = withDetailNotes(merged, detail ? detailLines(detail.rows) : [])
  const gaps = noted.filter(row => !row.iprName.trim())
  const decided = noted.filter(row => row.iprArbitrated).length
  const remindCount = noted.filter(row => row.letterKind !== 'national' && row.letterKind !== 'design').length
  const nationalCount = noted.filter(row => row.letterKind === 'national' || row.letterKind === 'design').length
  const hiddenRows = [...remindSheets, ...nationalSheets].reduce((sum, sheet) => sum + (sheet.hiddenRows ?? 0), 0)
  const notice = [
    named ? `提醒申请 PCT ${remindCount} 行，进国家 ${nationalCount} 行。` : '',
    hiddenRows ? `表格有筛选，隐藏的 ${hiddenRows} 行没有导入，导出也只含可见行。` : '',
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

export interface ArbitrationOptions {
  /** 客户要求没写发给谁时，允许仲裁把著录项目或表格里的技术联系人写成收件人。默认关：这类行拿不准留空，交给「全选联系人」。 */
  iprOnly?: boolean
}

function priorityLine(iprOnly: boolean): string {
  if (iprOnly) {
    return '优先级：1. 客户要求里明确写了发给谁、抄送谁，就按要求。收件人和抄送都可以是 IPR、发明人、客户联系人的任意组合。2. 客户要求没有指定收件人时，收件人只写著录项目或表格里的技术联系人，身份写 IPR。著录项目里仅仅列出来的发明人、客户联系人，不是发信要求。3. 没有明确要求，也没有技术联系人时，这一行写成拿不准，收件人留空。不要用客户联系人名单、技术负责人或商务去顶。'
  }
  return '优先级：1. 客户要求里明确写了发给谁、抄送谁，就按要求写全，不要因为本批的兜底规则而漏写。收件人和抄送都可以是 IPR、发明人、客户联系人的任意组合，客户要求点名了技术联系人也照样写。2. 只有客户要求没有指定收件人时，这一行直接写成拿不准，收件人留空，提交时用「全选联系人」兜底。依据只写「客户要求没有指定发给谁」一句，不要去著录项目或表格里对联系人，不要把著录项目里有没有联系人写进依据，也不要用发明人、客户联系人名单、技术负责人或商务来顶。'
}

function waveMessage(units: readonly ArbitrationUnit[], index: number, total: number, demands: Readonly<Record<string, string>>, cases: Readonly<Record<string, string>>, options: Readonly<ArbitrationOptions> = {}): string {
  const blocks = units.map(unit => unitBlock(unit, demands, cases))
  const text = [
    `请仲裁收件人和抄送。这是第 ${index}/${total} 批。材料只有下面这些文字：每一行的表格字段，以及核对时已经暂存的客户要求和著录项目。`,
    '每一行单独裁。第一客户联系人不同的，不能收成同一个人，也不能用一条结论盖住同客户的全部文号。',
    'IPR 就是技术联系人。身份只能是：发明人、客户联系人、IPR。多人用顿号，身份与人名一一对应。',
    '不要写商务、登录人、登陆人、密送、技术负责人。抄送商务、抄送登录人、密送登录人由系统在提交时默认追加。仲裁写了也会被丢掉，写抄送无也不会取消这些默认项。',
    priorityLine(options.iprOnly === true) + '抄送只写第 1 条里额外要点名的人，没有就写无。',
    '每一行只写一行，用竖线分开，文号原样照抄，外面不要加尖括号：',
    '文号 我方文号｜收件人 人名｜身份 身份｜抄送 人名或无｜抄送身份 身份或无｜依据 一句话',
    '拿不准的行写成：文号 我方文号｜拿不准｜依据 一句话。不要把身份写进人名括号，文号和人名外面也不要加尖括号。',
    '不要调用工具，不要构造接口，不要自己去查，不要创建任务，不要让用户挑选。裁完这一批就停。',
    ...blocks
  ].join('\n\n')
  return text.length > 18000 ? `${text.slice(0, 18000)}\n（后面的原文被截断了。）` : text
}

/** 空 IPR 按客户合并后再分批。一批一次交给本地模型。客户信息和著录项目用核对时暂存的文字，写进原文。 */
export function iprArbitrationWaves(
  rows: readonly PctTaskRow[],
  demands: Readonly<Record<string, string>> = {},
  cases: Readonly<Record<string, string>> = {},
  options: Readonly<ArbitrationOptions> = {}
): string[] {
  const units = arbitrationUnits(rows).flatMap(unit => splitOversized(unit, demands, cases))
  const waves: ArbitrationUnit[][] = []
  let rest = units
  while (rest.length) {
    const size = arbitrationBatchSize(rest.map(unit => unit.note))
    waves.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  return waves.map((wave, index) => waveMessage(wave, index + 1, waves.length, demands, cases, options))
}

/** 核对整表结束之后才能仲裁。材料是核对顺带带回来的，没结束就点会用到不完整的原文。 */
export function arbitrationAllowed(phase: 'idle' | 'run' | 'done' | 'fail'): boolean {
  return phase === 'done'
}

/** 整表核对结束、开关开着、还有空着的收件人，并且当前没有在交仲裁。补查没查成的不在这里自动开。 */
export function shouldAutoArbitrate(input: { fullCheck: boolean; phase: 'idle' | 'run' | 'done' | 'fail'; enabled: boolean; gaps: number; asking: boolean }): boolean {
  return input.fullCheck && arbitrationAllowed(input.phase) && input.enabled && input.gaps > 0 && !input.asking
}

/** 上传给助手的仲裁说明。只带 IPR 仍空着、并且核对时已经暂存了材料的行。 */
export function iprArbitrationBrief(
  rows: readonly PctTaskRow[],
  demands: Readonly<Record<string, string>> = {},
  cases: Readonly<Record<string, string>> = {},
  options: Readonly<ArbitrationOptions> = {}
): string {
  return iprArbitrationWaves(rows, demands, cases, options)[0] ?? ''
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

const ROLE_WORDS = ['发明人', '客户联系人', 'IPR', '技术联系人', '技术负责人', '商务', '登录人', '登陆人', '密送', '不用发']

function blankParty(value: string): boolean {
  return !value || /^(无|空|没有|不抄送|拿不准|不用发)/.test(value)
}

function partyText(value: string): string {
  const names = value.split(/[、,，]/).map(part => unwrapToken(part).replace(/[（(][^）)]{1,12}[）)]/g, '').trim()).filter(part => part && !blankParty(part))
  return names.join('、').slice(0, 200)
}

function unwrapToken(value: string): string {
  return value.replace(/^[<《「『"'\u201c*]+|[>》」』"'\u201d*]+$/g, '').trim()
}

function roleText(value: string, fallback: string): string {
  const picked = value.split(/[、,，]/).map(part => unwrapToken(part)).filter(part => ROLE_WORDS.includes(part))
  if (picked.length) return picked.join('、')
  const marked = fallback.match(/[（(]([^）)]+)[）)]/g)?.map(part => part.replace(/[（()）]/g, '').trim()).filter(part => ROLE_WORDS.includes(part)) ?? []
  return marked.join('、')
}

/** 商务、登录人、密送是提交时的默认项。技术负责人不是技术联系人，除非依据里写明这个人就是技术联系人。 */
function partySlots(names: string, roles: string, reason: string): { names: string; roles: string } {
  const nameList = names.split('、').map(item => item.trim()).filter(Boolean)
  const roleList = roles.split('、').map(item => item.trim()).filter(Boolean)
  const keptNames: string[] = []
  const keptRoles: string[] = []
  nameList.forEach((name, index) => {
    const role = roleList[index] || (roleList.length === 1 ? roleList[0] : '')
    if (/^(商务|登录人|登陆人|密送|发件人)$/.test(name) || /^(商务|登录人|登陆人|密送|发件人)$/.test(role)) return
    if (role === '技术负责人') {
      if (!/技术联系人|\bIPR\b/i.test(reason)) return
      keptNames.push(name)
      keptRoles.push('IPR')
      return
    }
    keptNames.push(name)
    if (role) keptRoles.push(role === '技术联系人' ? 'IPR' : role)
  })
  return { names: keptNames.join('、'), roles: keptRoles.join('、') }
}

function fieldOf(parts: string[], label: string): string {
  const found = parts.find(part => part === label || part.startsWith(`${label} `) || part.startsWith(`${label}：`) || part.startsWith(`${label}:`))
  if (!found || found === label) return ''
  return found.slice(label.length).replace(/^[：:\s]+/, '').trim()
}

function isCaseVolume(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._/-]*\d[A-Za-z0-9\u4e00-\u9fff._/-]*$/.test(value)
}

function decisionLines(text: string): string[] {
  const clean = text.replace(/```[\w-]*\n?/g, '').replace(/<\/?think>/gi, '')
  const out: string[] = []
  for (const line of clean.split(/\n+/)) {
    const pieces = line.split(/(?=文号(?:为|是)?\s*[｜|│丨:：]?\s*[<《「『"'\u201c*`]*\s*[A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._/-]*\d)/).map(part => part.trim()).filter(Boolean)
    if (pieces.length > 1) out.push(...pieces)
    else if (line.trim()) out.push(line.trim())
  }
  return out
}

/** 正式格式是「文号 我方文号」。模型也常写成「客户文号 我方文号」或「空 我方文号」。没有数字的词不是文号。 */
function volumeOf(line: string): string {
  const classic = line.match(/文号(?:为|是)?\s*[｜|│丨:：]?\s*[<《「『"'\u201c*`]*\s*([A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._/-]{1,80})/)
  if (classic?.[1] && isCaseVolume(classic[1])) return classic[1]
  const paired = line.match(/^(?:空|[A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._/-]{1,40})\s+([A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._/-]{1,80})\s*[｜|│丨]/)
  if (paired?.[1] && isCaseVolume(paired[1])) return paired[1]
  const single = line.match(/^([A-Za-z0-9][A-Za-z0-9\u4e00-\u9fff._/-]{1,80})\s*[｜|│丨]/)
  return single?.[1] && isCaseVolume(single[1]) ? single[1] : ''
}

/** 同一份回复里，短总结常常也带「文号」二字，但裁决行在另一段。取能对上更多文号的那一段。 */
export function pickArbitrationText(parts: readonly string[]): string {
  let best = ''
  let hits = -1
  for (const part of parts) {
    const text = part.trim()
    if (!text) continue
    const found = readArbitrationDecisions(text).length
    if (found > hits) {
      best = text
      hits = found
    }
  }
  return best
}

/** 从助手回复里取出每一行的收件人、身份和抄送。拿不准的也留下，但不写进表格。 */
export function readArbitrationDecisions(text: string): ArbitrationDecision[] {
  const decisions: ArbitrationDecision[] = []
  for (const raw of decisionLines(text)) {
    const line = raw.trim().replace(/^\d+[.、)\]]\s*/, '').replace(/^[-*]\s+/, '')
    const volume = volumeOf(line)
    if (!volume) continue
    const parts = line.split(/[｜|│丨]/).map(part => part.trim())
    const unsure = parts.some(part => part === '拿不准' || part.startsWith('拿不准')) || /[：:]\s*拿不准/.test(line)
    const reason = unwrapToken(fieldOf(parts, '依据')).slice(0, 120)
    if (unsure) {
      decisions.push({ volume, recipient: '', role: '', cc: '', ccRole: '', reason, unsure: true })
      continue
    }
    const recipientRaw = fieldOf(parts, '收件人') || line.match(/收件人\s*[：:\-]?\s*([^，,；;｜|\n]+)/)?.[1]?.trim() || ''
    const ccRaw = fieldOf(parts, '抄送') || line.match(/抄送\s*[：:\-]?\s*([^，,；;｜|\n]+)/)?.[1]?.trim() || ''
    const keptTo = partySlots(partyText(recipientRaw), roleText(fieldOf(parts, '身份'), recipientRaw), reason)
    const keptCc = partySlots(partyText(ccRaw), roleText(fieldOf(parts, '抄送身份'), ccRaw), reason)
    if (!keptTo.names) {
      if (fieldOf(parts, '收件人') || unsure) {
        decisions.push({ volume, recipient: '', role: '', cc: '', ccRole: '', reason, unsure: true })
      }
      continue
    }
    decisions.push({
      volume,
      recipient: keptTo.names,
      role: keptTo.roles,
      cc: keptCc.names,
      ccRole: keptCc.roles,
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
