import type { EasyTransport } from '../api/transport'
import { isRecord, readClientInfo } from '../api/response-guards'
import { listParams, readTableRows } from '../mail/easy/contracts'
import { isQueryGuid } from '../query/query-validator'

const DEPT_LABEL = '所属部门'
const DEPT_MARK = '研发本部'
const DESC = '文件描述'
const INVENTOR = '发明人'
const VOLUME = '我方案号'
const INVENTOR_PAGE = 10
const INVENTOR_PAGES = 20

export function departmentIncludesRnd(value: string): boolean {
  return value.includes(DEPT_MARK)
}

/** 按序号把发明人姓名拼成顿号分隔。空姓名丢掉，同名只留先出现的。 */
export function inventorNames(rows: Array<{ name: string; seq: number }>): string {
  const ordered = rows
    .map(row => ({ name: row.name.trim(), seq: row.seq }))
    .filter(row => row.name)
    .sort((left, right) => left.seq - right.seq)
  const seen = new Set<string>()
  const names: string[] = []
  for (const row of ordered) {
    if (seen.has(row.name)) continue
    seen.add(row.name)
    names.push(row.name)
  }
  return names.join('、')
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gi, '&')
}

function cellPlain(cell: string): string {
  return decode(cell.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function escapeCell(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function openTag(cell: string): string {
  return cell.match(/^<td\b[^>]*>/i)?.[0] ?? '<td>'
}

function withText(cell: string, text: string): string {
  return `${openTag(cell)}${escapeCell(text)}</td>`
}

function cellsOf(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)].map(item => item[0])
}

function rebuildRow(row: string, cells: string[]): string {
  const open = row.match(/^<tr\b[^>]*>/i)?.[0] ?? '<tr>'
  return `${open}${cells.join('')}</tr>`
}

/**
 * 在发文类型带出的表格上，于「文件描述」右侧放入「发明人」。
 * 已有这一列时只填格子。没有「我方案号」或「文件描述」时原样返回。
 */
export function insertInventorColumn(html: string, namesByVolume: ReadonlyMap<string, string>): string {
  if (!namesByVolume.size || !/<table\b/i.test(html)) return html
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
  for (const table of tables) {
    const source = table[0]
    const rows = [...source.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(item => item[0])
    const parsed = rows.map(row => ({ row, cells: cellsOf(row) }))
    const header = parsed.find(item => item.cells.some(cell => cellPlain(cell) === DESC))
    if (!header) continue
    const descIndex = header.cells.findIndex(cell => cellPlain(cell) === DESC)
    const volumeIndex = header.cells.findIndex(cell => cellPlain(cell) === VOLUME)
    if (descIndex < 0 || volumeIndex < 0) continue
    const already = cellPlain(header.cells[descIndex + 1] ?? '') === INVENTOR
    const nextRows = parsed.map(item => {
      const cells = item.cells.slice()
      if (!cells.length) return item.row
      const volume = cellPlain(cells[volumeIndex] ?? '')
      const names = namesByVolume.get(volume) ?? ''
      if (item === header) {
        if (!already) cells.splice(descIndex + 1, 0, withText(cells[descIndex] ?? '<td>', INVENTOR))
        return rebuildRow(item.row, cells)
      }
      const styleFrom = cells[descIndex] ?? '<td>'
      if (!already) cells.splice(descIndex + 1, 0, withText(styleFrom, names))
      else if (names) cells[descIndex + 1] = withText(cells[descIndex + 1] ?? styleFrom, names)
      return rebuildRow(item.row, cells)
    })
    let cursor = 0
    const rebuilt = source.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, () => nextRows[cursor++] ?? '')
    return html.replace(source, rebuilt)
  }
  return html
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function departmentColumn(transport: EasyTransport): Promise<{ ok: true; columnId: string } | { ok: false; message: string }> {
  const params = new URLSearchParams()
  params.set('Call', 'GetCustomField')
  params.set('table_name', 'p_case_info')
  params.set('log_pagename', 'CaseManage.aspx')
  const loaded = await transport.post('caseCustomField', params)
  if (!loaded.ok) return { ok: false, message: '所属部门没有读到，发明人列没有加。' }
  if (!isRecord(loaded.data)) return { ok: false, message: '所属部门没有读到，发明人列没有加。' }
  const client = readClientInfo(loaded.data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取所属部门时登录已失效。' }
  if (!Array.isArray(loaded.data.column_field_list)) return { ok: false, message: '所属部门没有读到，发明人列没有加。' }
  const hit = loaded.data.column_field_list.find(row => isRecord(row) && textField(row, 'column_name') === DEPT_LABEL && /^column_\d+$/.test(textField(row, 'column_id')))
  if (!isRecord(hit)) return { ok: false, message: '案件上没有名为所属部门的栏位，发明人列没有加。' }
  return { ok: true, columnId: textField(hit, 'column_id') }
}

async function caseDepartment(transport: EasyTransport, caseId: string, columnId: string): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
  const params = new URLSearchParams()
  params.set('Call', 'GetCaseInfo')
  params.set('case_id', caseId)
  params.set('log_pagename', 'CaseManage.aspx')
  const loaded = await transport.post('caseManageInfo', params)
  if (!loaded.ok) return { ok: false, message: '所属部门没有读到，发明人列没有加。' }
  if (!isRecord(loaded.data)) return { ok: false, message: '所属部门没有读到，发明人列没有加。' }
  const client = readClientInfo(loaded.data.ClientInfo)
  if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取所属部门时登录已失效。' }
  const row = Array.isArray(loaded.data.CaseInfo) ? loaded.data.CaseInfo.find(isRecord) : undefined
  if (!row) return { ok: false, message: '所属部门没有读到，发明人列没有加。' }
  return { ok: true, value: textField(row, columnId) }
}

async function caseInventors(transport: EasyTransport, caseId: string): Promise<{ ok: true; names: string } | { ok: false; message: string }> {
  const rows: Array<{ name: string; seq: number }> = []
  const seen = new Set<string>()
  for (let page = 1; page <= INVENTOR_PAGES; page += 1) {
    const params = new URLSearchParams()
    params.set('Call', 'GetCaseInventor')
    params.set('apply_id', caseId)
    params.set('pageSize', String(INVENTOR_PAGE))
    params.set('pageIndex', String(page))
    params.set('_PK', 'inventor_id')
    params.set('searchKey', '')
    params.set('colsel', ';code;inventor_name_cn;seq;inventor_id;')
    params.set('log_pagename', 'CaseManage.aspx')
    const loaded = await transport.post('caseInventor', params)
    if (!loaded.ok) return { ok: false, message: '发明人没有读到，没有提交。' }
    if (!isRecord(loaded.data)) return { ok: false, message: '发明人没有读到，没有提交。' }
    const client = readClientInfo(loaded.data.ClientInfo)
    if (!client.ok || client.data.IsLogin === false) return { ok: false, message: '读取发明人时登录已失效。' }
    if (loaded.data.TableRows === null) break
    if (!Array.isArray(loaded.data.TableRows)) return { ok: false, message: '发明人没有读到，没有提交。' }
    for (const row of loaded.data.TableRows) {
      if (!isRecord(row)) continue
      const id = textField(row, 'inventor_id').toLowerCase()
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      const seq = Number(textField(row, 'seq'))
      rows.push({ name: textField(row, 'inventor_name_cn'), seq: Number.isFinite(seq) ? seq : Number.MAX_SAFE_INTEGER })
    }
    if (loaded.data.TableRows.length < INVENTOR_PAGE) break
  }
  return { ok: true, names: inventorNames(rows) }
}

async function mailCases(transport: EasyTransport, mailId: string): Promise<{ ok: true; cases: Array<{ id: string; volume: string }> } | { ok: false; message: string }> {
  const cases: Array<{ id: string; volume: string }> = []
  for (let page = 1; page <= 5; page += 1) {
    const loaded = await transport.post('getMailCase', listParams('GetMailCase', mailId, page))
    if (!loaded.ok) return { ok: false, message: '发文上的案件没有读到，发明人列没有加。' }
    const parsed = readTableRows(loaded.data, 'case_id', 'case_volume')
    if (parsed.state === 'invalid') return { ok: false, message: '发文上的案件没有读到，发明人列没有加。' }
    if (parsed.state !== 'known') break
    for (const row of parsed.rows) {
      if (!isQueryGuid(row.id) || !row.name.trim()) continue
      cases.push({ id: row.id, volume: row.name.trim() })
    }
    const reached = parsed.total !== null && cases.length >= parsed.total
    if (reached || parsed.rows.length < 100) break
  }
  return { ok: true, cases }
}

/** 所属部门包含研发本部的案件，把全部发明人写进正文表格。读不到时不改正文，登录失效才停住。 */
export async function bodyWithRndInventors(transport: EasyTransport, mailId: string, html: string): Promise<{ ok: true; html: string; note: string } | { ok: false; message: string }> {
  if (!html.includes(DESC)) return { ok: true, html, note: '' }
  const cases = await mailCases(transport, mailId)
  if (!cases.ok) return cases.message.includes('登录') ? { ok: false, message: cases.message } : { ok: true, html, note: cases.message }
  if (!cases.cases.length) return { ok: true, html, note: '' }
  const column = await departmentColumn(transport)
  if (!column.ok) return column.message.includes('登录') ? { ok: false, message: column.message } : { ok: true, html, note: column.message }
  const names = new Map<string, string>()
  for (const item of cases.cases) {
    const dept = await caseDepartment(transport, item.id, column.columnId)
    if (!dept.ok) return dept.message.includes('登录') ? { ok: false, message: dept.message } : { ok: true, html, note: dept.message }
    if (!departmentIncludesRnd(dept.value)) continue
    const inventors = await caseInventors(transport, item.id)
    if (!inventors.ok) return { ok: false, message: `文号 ${item.volume} 的${inventors.message}` }
    names.set(item.volume, inventors.names)
  }
  if (!names.size) return { ok: true, html, note: '' }
  return { ok: true, html: insertInventorColumn(html, names), note: '所属部门包含研发本部的案件，已在文件描述右侧写入全部发明人。' }
}
