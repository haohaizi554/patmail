import { isQueryGuid } from '../query/query-validator'
import { PCT_REMINDER, pctMailTypeFor, pctVolumeSlot } from './mail-flow'
import type { PctTaskDraft, PctTaskRow } from './types'
import { joinCaseVolumes, splitCaseVolumes } from './volume-list'

const HEADER = {
  ourVolume: '我方文号',
  customerVolume: '客户文号',
  customerName: '客户名称',
  contactName: '第一客户联系人',
  iprName: '客户联系人(IPR)',
  procLabel: '处理事项'
} as const

function cell(row: string[], index: number): string {
  if (index < 0) return ''
  return (row[index] ?? '').trim().slice(0, 80)
}

export function pctRowsFromTable(table: string[][], mailTypes: Array<{ id: string; name: string }> = []): { rows: PctTaskRow[]; notice: string } {
  const header = (table[0] ?? []).map(item => item.trim())
  const column = (name: string) => header.indexOf(name)
  const our = column(HEADER.ourVolume)
  const proc = column(HEADER.procLabel)
  if (our < 0 || proc < 0) {
    return { rows: [], notice: '表格要有「我方文号」和「处理事项」这两列。' }
  }
  const customer = column(HEADER.customerVolume)
  const name = column(HEADER.customerName)
  const contact = column(HEADER.contactName)
  const ipr = column(HEADER.iprName)
  const rows: PctTaskRow[] = []
  let skipped = 0
  for (const source of table.slice(1)) {
    const ourVolume = cell(source, our)
    const customerVolume = cell(source, customer)
    const slot = pctVolumeSlot({ customerVolume, ourVolume })
    const picked = pctMailTypeFor({ customerVolume, ourVolume }, mailTypes)
    if (!slot || !ourVolume) {
      skipped += 1
      continue
    }
    rows.push({
      ourVolume,
      customerVolume,
      customerName: cell(source, name),
      contactName: cell(source, contact),
      iprName: cell(source, ipr),
      procLabel: cell(source, proc),
      mailTypeLabel: picked?.name ?? '',
      ...(picked ? { mailTypeId: picked.id, mailTypeRadioIndex: picked.radioIndex } : { mailTypeRadioIndex: slot.radioIndex })
    })
    if (rows.length >= 300) break
  }
  if (!rows.length) return { rows: [], notice: skipped ? '表格里没有同时带我方文号、并能判断发文类型的行。' : '表格里没有数据行。' }
  const other = rows.filter(row => row.procLabel && row.procLabel !== PCT_REMINDER.procLabel).length
  const notice = [
    `读到 ${rows.length} 行。`,
    other ? `其中 ${other} 行的处理事项不是「${PCT_REMINDER.procLabel}」。` : '',
    skipped ? `跳过 ${skipped} 行没有文号的记录。` : ''
  ].filter(Boolean).join('')
  return { rows, notice }
}

export function clonePctTask(task: PctTaskDraft): PctTaskDraft {
  return {
    workflowId: 'pct-reminder',
    ctrlProcId: task.ctrlProcId,
    createdAt: task.createdAt,
    confirmedProcIds: [...task.confirmedProcIds],
    ...(task.mailsetId && task.mailsetLabel ? { mailsetId: task.mailsetId, mailsetLabel: task.mailsetLabel } : {}),
    ...(task.mailTo ? { mailTo: task.mailTo } : {}),
    ...(task.mailCc ? { mailCc: task.mailCc } : {}),
    rows: task.rows.map(row => ({ ...row }))
  }
}

export function volumesOf(rows: PctTaskRow[]): string[] {
  return splitCaseVolumes(joinCaseVolumes(rows.map(row => row.ourVolume)))
}

export function applyPctMailTypes(rows: PctTaskRow[], mailTypes: Array<{ id: string; name: string }>): PctTaskRow[] {
  const next = pctRowsFromTable([
    ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
    ...rows.map(row => [row.ourVolume, row.customerVolume, row.customerName, row.contactName, row.iprName, row.procLabel])
  ], mailTypes).rows
  return next.map(row => {
    const prev = rows.find(item => item.ourVolume.replace(/\s/g, '') === row.ourVolume.replace(/\s/g, ''))
    if (!prev) return row
    return {
      ...row,
      ...(prev.mailTo ? { mailTo: prev.mailTo } : {}),
      ...(prev.mailCc ? { mailCc: prev.mailCc } : {})
    }
  })
}

/** 表格里的处理事项名称，对原站处理事项列表里的具体项。分类节点和重名都不选用。 */
export function matchSheetCtrlProcs(
  labels: string[],
  options: Array<{ id: string; label: string; parentId?: string }>
): { ok: true; ids: string; names: string[] } | { ok: false; message: string } {
  const wanted = [...new Set(labels.map(item => item.trim()).filter(Boolean))]
  if (!wanted.length) return { ok: false, message: '表格里没有处理事项，查不了。' }
  if (!options.length) return { ok: false, message: '处理事项列表还没从原网站读到。' }
  const parents = new Set(options.map(item => item.parentId).filter((item): item is string => Boolean(item)))
  const ids: string[] = []
  const names: string[] = []
  for (const label of wanted) {
    const exact = options.filter(item => item.label.trim() === label && isQueryGuid(item.id))
    const leaves = exact.filter(item => !parents.has(item.id))
    if (leaves.length !== 1) {
      if (!exact.length) return { ok: false, message: `表格里的处理事项「${label}」没有在原网站列表里对上。` }
      if (!leaves.length) return { ok: false, message: `处理事项「${label}」对上的是分类，不是具体事项。` }
      return { ok: false, message: `处理事项「${label}」在原网站对上了多项，没有选用。` }
    }
    ids.push(leaves[0].id)
    names.push(label)
  }
  return { ok: true, ids: ids.join(','), names }
}

export function summarizePctTask(task: PctTaskDraft): string {
  const names = [...new Set(task.rows.map(row => row.mailTypeLabel.trim()).filter(Boolean))]
  const detail = names.map(label => `${label} ${task.rows.filter(row => row.mailTypeLabel === label).length} 件`).join('，')
  return `${task.rows.length} 行。发文类型：${detail || '还没从原网站读到'}。已确认勾选 ${task.confirmedProcIds.length} 件。`
}
