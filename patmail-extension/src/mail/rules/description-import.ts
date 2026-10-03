import { isQueryGuid } from '../../query/query-validator'
import type { DescriptionMailTypeMapping } from '../types'

export interface ImportMailType {
  id: string
  name: string
  parentId?: string
}

export interface MergeImportedMappingsOptions {
  now: string
  createId: () => string
}

type Role = 'description' | 'mailType' | 'descriptionId' | 'mailTypeId'

interface ColumnMap {
  header: number
  description: number
  mailType: number
  descriptionId: number
  mailTypeId: number
}

type TypeMatch =
  | { kind: 'ok'; id: string; name: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }

export type MergeImportedMappingsResult =
  | { ok: true; mappings: DescriptionMailTypeMapping[]; added: number; notice: string }
  | { ok: false; message: string }

function clean(value: string): string {
  return value.normalize('NFKC').replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim()
}

function normHeader(value: string): string {
  return clean(value).toLowerCase().replace(/[\s:：_\-—/\\|·.。,，()（）【】[\]"'“”‘’]/g, '')
}

function roleOf(cell: string): { role: Role; score: number } | null {
  const text = normHeader(cell)
  if (!text) return null
  if (text === '文件描述id' || text === 'filedescriptionid' || text === '描述id') return { role: 'descriptionId', score: 3 }
  if (text === '发文类型id' || text === '邮件类型id' || text === 'mailtypeid') return { role: 'mailTypeId', score: 3 }
  if (text.includes('文件描述') || text.includes('来文描述') || text.includes('来文名称') || text.includes('官文名称') || text.includes('官文描述')) {
    return { role: 'description', score: 3 }
  }
  if (text.includes('发文类型') || text.includes('邮件类型') || text.includes('官文类型')) return { role: 'mailType', score: 3 }
  if (text === '描述' || text === 'description' || text === 'filedescription') return { role: 'description', score: 2 }
  if (text === '类型' || text === 'mailtype' || text === 'mailtypename') return { role: 'mailType', score: 2 }
  return null
}

function columnsOf(row: string[]): Partial<Record<Role, number>> {
  const best: Partial<Record<Role, { index: number; score: number }>> = {}
  row.forEach((cell, index) => {
    if (index > 20) return
    const found = roleOf(cell)
    if (!found) return
    const current = best[found.role]
    if (!current || found.score > current.score) best[found.role] = { index, score: found.score }
  })
  const picked: Partial<Record<Role, number>> = {}
  for (const role of ['description', 'mailType', 'descriptionId', 'mailTypeId'] as const) {
    const column = best[role]
    if (column) picked[role] = column.index
  }
  return picked
}

function pathOf(node: ImportMailType, byId: Map<string, ImportMailType>): string {
  const names: string[] = []
  let current: ImportMailType | undefined = node
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(clean(current.name))
    const nextParent: string = current.parentId?.trim() ?? ''
    current = nextParent ? byId.get(nextParent) : undefined
  }
  return names.join('/')
}

function compact(value: string): string {
  return clean(value).toLowerCase().replace(/\s+/g, '').replace(/[／\\]/g, '/')
}

function pickByName(matches: Array<{ node: ImportMailType }>, nodes: ImportMailType[]): TypeMatch | null {
  if (matches.length === 1) return { kind: 'ok', id: matches[0].node.id, name: matches[0].node.name }
  if (matches.length < 2) return null
  const parents = new Set(nodes.map(node => node.parentId?.trim()).filter((id): id is string => Boolean(id)))
  const leaves = matches.filter(item => !parents.has(item.node.id))
  if (leaves.length === 1) return { kind: 'ok', id: leaves[0].node.id, name: leaves[0].node.name }
  return { kind: 'ambiguous' }
}

function matchLabel(label: string, nodes: ImportMailType[], byId: Map<string, ImportMailType>): TypeMatch {
  const wanted = compact(label)
  if (!wanted) return { kind: 'missing' }
  if (isQueryGuid(clean(label))) {
    const hit = nodes.find(node => node.id.toLowerCase() === clean(label).toLowerCase())
    return hit ? { kind: 'ok', id: hit.id, name: hit.name } : { kind: 'missing' }
  }
  const ranked = nodes.map(node => ({ node, path: compact(pathOf(node, byId)), name: compact(node.name) }))
  const byName = ranked.filter(item => item.name === wanted)
  if (!wanted.includes('/')) {
    const named = pickByName(byName, nodes)
    if (named) return named
  }
  const byPath = ranked.filter(item => item.path === wanted)
  if (byPath.length === 1) return { kind: 'ok', id: byPath[0].node.id, name: byPath[0].node.name }
  if (byPath.length > 1) return { kind: 'ambiguous' }
  return pickByName(byName, nodes) ?? { kind: 'missing' }
}

function locate(table: string[][], nodes: ImportMailType[]): ColumnMap | { message: string } {
  let sawDescription = false
  let sawType = false
  const limit = Math.min(table.length, 12)
  for (let index = 0; index < limit; index += 1) {
    const found = columnsOf(table[index] ?? [])
    if (found.description !== undefined || found.descriptionId !== undefined) sawDescription = true
    if (found.mailType !== undefined || found.mailTypeId !== undefined) sawType = true
    const description = found.description ?? found.descriptionId
    const mailType = found.mailType ?? found.mailTypeId
    if (description === undefined || mailType === undefined) continue
    return {
      header: index,
      description: found.description ?? -1,
      mailType: found.mailType ?? -1,
      descriptionId: found.descriptionId ?? -1,
      mailTypeId: found.mailTypeId ?? -1
    }
  }
  if (sawDescription && !sawType) return { message: '认出了文件描述，还缺「发文类型」这一列。' }
  if (sawType && !sawDescription) return { message: '认出了发文类型，还缺「文件描述」这一列。' }
  const inferred = inferColumns(table, nodes)
  if (inferred) {
    return { header: -1, description: inferred.description, mailType: inferred.mailType, descriptionId: -1, mailTypeId: -1 }
  }
  if (!nodes.length) return { message: '发文类型还没读到。先重新读取发文类型，再导入。' }
  return { message: '没有认出文件描述和发文类型。表头写成「文件描述」「发文类型」，或把描述放第一列、类型放第二列。' }
}

function inferColumns(table: string[][], nodes: ImportMailType[]): { description: number; mailType: number } | null {
  if (!nodes.length || !table.length) return null
  const byId = new Map(nodes.map(node => [node.id, node]))
  const width = Math.min(12, table.reduce((max, row) => Math.max(max, row.length), 0))
  let typeBest: { index: number; hits: number } | null = null
  for (let column = 0; column < width; column += 1) {
    let nonEmpty = 0
    let hits = 0
    for (const row of table) {
      const cell = clean(row[column] ?? '')
      if (!cell || roleOf(cell)) continue
      nonEmpty += 1
      if (matchLabel(cell, nodes, byId).kind !== 'missing') hits += 1
    }
    if (nonEmpty < 1 || hits / nonEmpty < 0.5) continue
    if (!typeBest || hits > typeBest.hits) typeBest = { index: column, hits }
  }
  if (!typeBest) return null
  let description = -1
  let count = 0
  for (let column = 0; column < width; column += 1) {
    if (column === typeBest.index) continue
    const filled = table.filter(row => clean(row[column] ?? '') && !roleOf(clean(row[column] ?? ''))).length
    if (filled > count) {
      count = filled
      description = column
    }
  }
  return description < 0 ? null : { description, mailType: typeBest.index }
}

function cell(row: string[], index: number): string {
  if (index < 0) return ''
  return clean(row[index] ?? '').slice(0, 200)
}

function quoted(items: string[]): string {
  const unique = [...new Set(items.map(item => clean(item)).filter(Boolean))]
  const shown = unique.slice(0, 3).map(item => `「${item.slice(0, 40)}」`).join('、')
  return unique.length > 3 ? `${shown}等 ${unique.length} 个` : shown
}

function importKey(item: { fileDescriptionId?: string; fileDescriptionText?: string }): string | null {
  const id = clean(item.fileDescriptionId ?? '')
  if (id && isQueryGuid(id)) return `id:${id.toLowerCase()}`
  const text = clean(item.fileDescriptionText ?? '')
  return text ? `text:${text}` : null
}

function noticeOf(stats: {
  added: number
  existing: number
  duplicate: number
  fileConflict: string[]
  existingConflict: string[]
  missing: string[]
  ambiguous: string[]
  mismatch: string[]
}): string {
  const parts = [`新增 ${stats.added} 条。`]
  if (stats.existing) parts.push(`已有 ${stats.existing} 条，没有重复写入。`)
  if (stats.duplicate) parts.push(`表格里相同的 ${stats.duplicate} 条已去掉。`)
  if (stats.fileConflict.length) parts.push(`这些描述在表格里对应了多个发文类型，后出现的没有写入：${quoted(stats.fileConflict)}。`)
  if (stats.existingConflict.length) parts.push(`这些描述已经对应另一个发文类型，没有改：${quoted(stats.existingConflict)}。`)
  if (stats.missing.length) parts.push(`这些发文类型没有对上：${quoted(stats.missing)}。`)
  if (stats.ambiguous.length) parts.push(`这些发文类型对上了多项，没有选用：${quoted(stats.ambiguous)}。`)
  if (stats.mismatch.length) parts.push(`这些行的发文类型名称和编号不一致，没有写入：${quoted(stats.mismatch)}。`)
  return parts.join('')
}

/** 从表格并入文件描述映射。相同描述只保留一条，已经存在的不改、不重复添加。 */
export function mergeImportedMappings(
  mappings: DescriptionMailTypeMapping[],
  table: string[][],
  mailTypes: ImportMailType[],
  options: MergeImportedMappingsOptions
): MergeImportedMappingsResult {
  const nodes = mailTypes.filter(node => isQueryGuid(node.id) && clean(node.name))
  const located = locate(table, nodes)
  if ('message' in located) return { ok: false, message: located.message }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const data = table.slice(located.header + 1, located.header + 1 + 2000)
  if (!data.length) return { ok: false, message: '表格里没有数据行。' }
  const chosen = new Map<string, string>()
  const pending: DescriptionMailTypeMapping[] = []
  const stats = {
    added: 0,
    existing: 0,
    duplicate: 0,
    fileConflict: [] as string[],
    existingConflict: [] as string[],
    missing: [] as string[],
    ambiguous: [] as string[],
    mismatch: [] as string[]
  }
  for (const row of data) {
    const text = located.description < 0 ? '' : cell(row, located.description)
    const descriptionId = cell(row, located.descriptionId)
    const fileDescriptionId = isQueryGuid(descriptionId) ? descriptionId : undefined
    const nameCell = cell(row, located.mailType)
    const idCell = cell(row, located.mailTypeId)
    const descriptionIsHeader = Boolean(text && roleOf(text)?.role === 'description' && !fileDescriptionId)
    const typeIsHeader = Boolean(nameCell && roleOf(nameCell)?.role === 'mailType' && !idCell)
    if (descriptionIsHeader && typeIsHeader) continue
    const fileDescriptionText = text
    if (!fileDescriptionId && !fileDescriptionText) continue
    const label = fileDescriptionText || fileDescriptionId || ''
    const byGuid = isQueryGuid(idCell) ? nodes.find(node => node.id.toLowerCase() === idCell.toLowerCase()) : undefined
    const byName = nameCell ? matchLabel(nameCell, nodes, byId) : null
    if (byGuid && byName?.kind === 'ok' && byGuid.id.toLowerCase() !== byName.id.toLowerCase()) {
      stats.mismatch.push(label)
      continue
    }
    const resolved = byGuid
      ? { kind: 'ok' as const, id: byGuid.id, name: byGuid.name }
      : byName
    if (!resolved || resolved.kind === 'missing') {
      stats.missing.push(nameCell || idCell || `${label}（没有发文类型）`)
      continue
    }
    if (resolved.kind === 'ambiguous') {
      stats.ambiguous.push(nameCell || label)
      continue
    }
    const key = importKey({ fileDescriptionId, fileDescriptionText })
    if (!key) continue
    const previous = chosen.get(key)
    if (previous) {
      if (previous === resolved.id.toLowerCase()) stats.duplicate += 1
      else stats.fileConflict.push(label)
      continue
    }
    const same = mappings.filter(item => importKey(item) === key)
    if (same.some(item => item.mailTypeId.toLowerCase() === resolved.id.toLowerCase())) {
      chosen.set(key, resolved.id.toLowerCase())
      stats.existing += 1
      continue
    }
    if (same.some(item => item.enabled)) {
      chosen.set(key, resolved.id.toLowerCase())
      stats.existingConflict.push(label)
      continue
    }
    chosen.set(key, resolved.id.toLowerCase())
    pending.push({
      id: options.createId(),
      ...(fileDescriptionId ? { fileDescriptionId } : {}),
      ...(fileDescriptionText ? { fileDescriptionText } : {}),
      mailTypeId: resolved.id,
      mailTypeName: resolved.name,
      enabled: true,
      version: 1,
      updatedAt: options.now
    })
  }
  stats.added = pending.length
  if (!stats.added && !stats.existing && !stats.duplicate && !stats.fileConflict.length && !stats.existingConflict.length && !stats.missing.length && !stats.ambiguous.length && !stats.mismatch.length) {
    return { ok: false, message: '表格里没有可导入的映射。' }
  }
  return {
    ok: true,
    mappings: stats.added ? mappings.concat(pending) : mappings,
    added: stats.added,
    notice: noticeOf(stats)
  }
}
