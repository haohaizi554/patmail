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
    rows: task.rows.map(row => ({ ...row }))
  }
}

export function volumesOf(rows: PctTaskRow[]): string[] {
  return splitCaseVolumes(joinCaseVolumes(rows.map(row => row.ourVolume)))
}

export function applyPctMailTypes(rows: PctTaskRow[], mailTypes: Array<{ id: string; name: string }>): PctTaskRow[] {
  return pctRowsFromTable([
    ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
    ...rows.map(row => [row.ourVolume, row.customerVolume, row.customerName, row.contactName, row.iprName, row.procLabel])
  ], mailTypes).rows
}

export function summarizePctTask(task: PctTaskDraft): string {
  const names = [...new Set(task.rows.map(row => row.mailTypeLabel.trim()).filter(Boolean))]
  const detail = names.map(label => `${label} ${task.rows.filter(row => row.mailTypeLabel === label).length} 件`).join('，')
  return `${task.rows.length} 行。发文类型：${detail || '还没从原网站读到'}。已确认勾选 ${task.confirmedProcIds.length} 件。`
}
