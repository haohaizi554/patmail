import { isPctTask } from './guards'
import { isQueryGuid } from '../query/query-validator'
import { resolvePctRuntime, type PctRuntimeConfig } from '../workflow/pct-config'
import { matchMailTypeByName, pctMailTypeFor, pctVolumeSlot } from './mail-flow'
import { sheetDisplayName } from './pct-recipients'
import { normalizeCustomerName } from './skills'
import type { PctTaskDraft, PctTaskRow } from './types'
import { joinCaseVolumes, splitCaseVolumes } from './volume-list'

function cell(row: string[], index: number): string {
  if (index < 0) return ''
  return (row[index] ?? '').trim().slice(0, 80)
}

export const NATIONAL_PROC_LABEL = 'PCT进国家阶段官方绝限'
export const NATIONAL_OUR_TYPE = '提醒PCT申请进入国家案件（我方案号）'
export const NATIONAL_CUSTOMER_TYPE = '提醒PCT申请进入国家案件（贵方案号）'
export const DESIGN_CUSTOMER_TYPE = '提醒涉外外观申请（贵方案号）'

/** 进国家：有我方文号就用我方案号，没有再用贵方。外观只用贵方案号那一种。 */
export function nationalTypeName(input: { ourVolume?: string; customerVolume?: string; procLabel?: string; letterKind?: PctTaskRow['letterKind'] }): string {
  if (input.letterKind === 'design' || /外观/.test(input.procLabel ?? '')) return DESIGN_CUSTOMER_TYPE
  if (input.ourVolume?.trim()) return NATIONAL_OUR_TYPE
  return NATIONAL_CUSTOMER_TYPE
}

export function pctRowsFromTable(table: string[][], mailTypes: Array<{ id: string; name: string }> = [], config?: PctRuntimeConfig, sheetKind: 'remind' | 'national' = 'remind'): { rows: PctTaskRow[]; notice: string } {
  const runtime = resolvePctRuntime(config)
  const header = (table[0] ?? []).map(item => item.trim())
  const column = (name: string) => header.indexOf(name)
  const our = column(runtime.columns.ourVolume)
  const proc = column(runtime.columns.procLabel)
  if (our < 0 || proc < 0) {
    return { rows: [], notice: `表格要有「${runtime.columns.ourVolume}」和「${runtime.columns.procLabel}」这两列。` }
  }
  const customer = column(runtime.columns.customerVolume)
  const name = column(runtime.columns.customerName)
  const contact = column(runtime.columns.contactName)
  const ipr = column(runtime.columns.iprName)
  const lead = runtime.columns.leadName ? column(runtime.columns.leadName) : -1
  const rows: PctTaskRow[] = []
  let skipped = 0
  for (const source of table.slice(1)) {
    const ourVolume = cell(source, our)
    const customerVolume = cell(source, customer)
    const procLabel = cell(source, proc)
    const letterKind: PctTaskRow['letterKind'] = /外观/.test(procLabel) ? 'design' : sheetKind
    const slot = letterKind === 'remind' ? pctVolumeSlot({ customerVolume, ourVolume }, runtime) : null
    if (letterKind === 'remind' ? !slot || !ourVolume : !ourVolume && !customerVolume) {
      skipped += 1
      continue
    }
    const picked = letterKind === 'remind'
      ? pctMailTypeFor({ customerVolume, ourVolume }, mailTypes, runtime)
      : matchMailTypeByName(mailTypes, nationalTypeName({ ourVolume, customerVolume, procLabel, letterKind }))
    const nationalName = letterKind === 'remind' ? '' : nationalTypeName({ ourVolume, customerVolume, procLabel, letterKind })
    rows.push({
      ourVolume,
      customerVolume,
      customerName: cell(source, name),
      contactName: cell(source, contact),
      iprName: cell(source, ipr),
      ...(lead >= 0 ? { leadName: sheetDisplayName(cell(source, lead)) } : {}),
      procLabel,
      letterKind,
      mailTypeLabel: picked?.name ?? nationalName,
      ...(picked ? { mailTypeId: picked.id, ...(letterKind === 'remind' && slot ? { mailTypeRadioIndex: slot.radioIndex } : {}) } : letterKind === 'remind' && slot ? { mailTypeRadioIndex: slot.radioIndex } : {})
    })
    if (rows.length >= 5000) break
  }
  const carried = carryCustomerContacts(rows)
  if (!carried.rows.length) return { rows: [], notice: skipped ? '表格里没有同时带我方文号、并能判断发文类型的行。' : '表格里没有数据行。' }
  const other = sheetKind === 'remind' ? carried.rows.filter(row => row.procLabel && row.procLabel !== runtime.procLabel).length : 0
  const notice = [
    `读到 ${carried.rows.length} 行。`,
    carried.filled ? `同客户后面空着的联系人，沿用了该客户最近一行。` : '',
    runtime.columns.leadName && lead < 0 ? `表格没有「${runtime.columns.leadName}」这一列。` : '',
    other ? `其中 ${other} 行的处理事项不是「${runtime.procLabel}」。` : '',
    skipped ? `跳过 ${skipped} 行没有文号的记录。` : ''
  ].filter(Boolean).join('')
  return { rows: carried.rows, notice }
}

/** 联系人沿用该客户往上最近一行。IPR 只补紧挨着的同客户空行，中间隔了别的客户就断开。 */
function carryCustomerContacts(rows: PctTaskRow[]): { rows: PctTaskRow[]; filled: number } {
  const remembered = new Map<string, { contactName: string; leadName: string }>()
  let filled = 0
  let previousKey = ''
  let streakIpr = ''
  const next = rows.map(row => {
    const key = normalizeCustomerName(row.customerName)
    if (!key) {
      previousKey = ''
      streakIpr = ''
      return row
    }
    const previous = remembered.get(key)
    const contactName = row.contactName.trim() || previous?.contactName || ''
    const leadName = (row.leadName ?? '').trim() || previous?.leadName || ''
    const ownIpr = row.iprName.trim()
    const iprName = ownIpr || (key === previousKey ? streakIpr : '')
    previousKey = key
    streakIpr = iprName
    const contactCarried = !row.contactName.trim() && Boolean(contactName)
    const iprCarried = !ownIpr && Boolean(iprName)
    const leadCarried = row.leadName !== undefined && !(row.leadName ?? '').trim() && Boolean(leadName)
    remembered.set(key, { contactName, leadName })
    if (!contactCarried && !iprCarried && !leadCarried) return row
    filled += 1
    return {
      ...row,
      contactName,
      iprName,
      ...(row.leadName !== undefined || leadCarried ? { leadName } : {}),
      ...(contactCarried ? { contactCarried: true as const } : {}),
      ...(iprCarried ? { iprCarried: true as const } : {}),
      ...(leadCarried ? { leadCarried: true as const } : {})
    }
  })
  return { rows: next, filled }
}

export const PCT_WORKFLOW_TASK_KEY = 'patmail.pctWorkflowTask'

export function readWorkflowTask(): PctTaskDraft | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PCT_WORKFLOW_TASK_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isPctTask(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeWorkflowTask(task: PctTaskDraft): void {
  sessionStorage.setItem(PCT_WORKFLOW_TASK_KEY, JSON.stringify(clonePctTask(task)))
}

export function clonePctTask(task: PctTaskDraft): PctTaskDraft {
  const workflowId = /^[a-z][a-z0-9-]{0,40}$/.test(task.workflowId) ? task.workflowId : 'pct-reminder'
  return {
    workflowId,
    ctrlProcId: task.ctrlProcId,
    createdAt: task.createdAt,
    confirmedProcIds: [...task.confirmedProcIds],
    ...(task.recipientMode === 'ipr' || task.recipientMode === 'lead' ? { recipientMode: task.recipientMode } : {}),
    ...(task.mailsetId && task.mailsetLabel ? { mailsetId: task.mailsetId, mailsetLabel: task.mailsetLabel } : {}),
    ...(task.mailTo ? { mailTo: task.mailTo } : {}),
    ...(task.mailCc ? { mailCc: task.mailCc } : {}),
    rows: task.rows.map(row => ({ ...row }))
  }
}

export function volumesOf(rows: PctTaskRow[]): string[] {
  return splitCaseVolumes(joinCaseVolumes(rows.map(row => row.ourVolume)))
}

export function applyPctMailTypes(rows: PctTaskRow[], mailTypes: Array<{ id: string; name: string }>, config?: PctRuntimeConfig): PctTaskRow[] {
  return rows.map(row => {
    if (row.letterKind === 'national' || row.letterKind === 'design') {
      const name = nationalTypeName(row)
      const picked = matchMailTypeByName(mailTypes, name)
      return { ...row, mailTypeLabel: picked?.name ?? name, ...(picked ? { mailTypeId: picked.id } : {}) }
    }
    const picked = pctMailTypeFor(row, mailTypes, config)
    if (!picked) return row
    return { ...row, mailTypeLabel: picked.name, mailTypeId: picked.id, mailTypeRadioIndex: picked.radioIndex }
  })
}

/** 两张表各看各的事项。进国家行不是「提醒申请PCT」的例外。 */
export function procGapNotes(rows: readonly PctTaskRow[], remindLabel: string): string[] {
  const remind = remindLabel.trim()
  const remindOff = rows.filter(row => (row.letterKind ?? 'remind') === 'remind' && row.procLabel.trim() && row.procLabel.trim() !== remind).length
  const nationalOff = rows.filter(row => row.letterKind === 'national' && row.procLabel.trim() && row.procLabel.trim() !== NATIONAL_PROC_LABEL).length
  const notes: string[] = []
  if (remindOff) notes.push(`提醒申请 PCT 表有 ${remindOff} 行的处理事项不是「${remind}」。`)
  if (nationalOff) notes.push(`进国家表有 ${nationalOff} 行的处理事项不是「${NATIONAL_PROC_LABEL}」。`)
  return notes
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

/** 把表格收成一份可保存的 PCT 任务。多种处理事项不能塞进同一个事项编号。 */
export function buildPctTask(input: {
  rows: PctTaskRow[]
  ctrlProcId: string
  confirmedProcIds: string[]
  sender?: { mailsetId: string; label: string }
  createdAt: string
  workflowId?: string
  recipientMode?: 'ipr' | 'lead'
}): { ok: true; task: PctTaskDraft } | { ok: false; message: string } {
  if (!isQueryGuid(input.ctrlProcId)) {
    return {
      ok: false,
      message: input.ctrlProcId.includes(',')
        ? '表格里有多种处理事项。一次任务只对上一个事项。'
        : '处理事项还没对上原网站。'
    }
  }
  const workflowId = input.workflowId && /^[a-z][a-z0-9-]{0,40}$/.test(input.workflowId) ? input.workflowId : 'pct-reminder'
  const task: PctTaskDraft = {
    workflowId,
    ctrlProcId: input.ctrlProcId,
    rows: input.rows,
    confirmedProcIds: input.confirmedProcIds.filter(item => isQueryGuid(item)),
    ...(input.recipientMode === 'ipr' || input.recipientMode === 'lead' ? { recipientMode: input.recipientMode } : {}),
    ...(input.sender ? { mailsetId: input.sender.mailsetId, mailsetLabel: input.sender.label } : {}),
    createdAt: input.createdAt
  }
  if (!isPctTask(task)) {
    const tooLong = input.rows.some(row => (row.mailTo?.length ?? 0) > 4000 || (row.mailCc?.length ?? 0) > 4000)
    return { ok: false, message: tooLong ? '某一行的收件人或抄送太长，任务没有保存。' : '这张表格组不成任务。' }
  }
  return { ok: true, task }
}

export function summarizePctTask(task: PctTaskDraft): string {
  const names = [...new Set(task.rows.map(row => row.mailTypeLabel.trim()).filter(Boolean))]
  const detail = names.map(label => `${label} ${task.rows.filter(row => row.mailTypeLabel === label).length} 件`).join('，')
  return `${task.rows.length} 行。发文类型：${detail || '还没从原网站读到'}。已确认勾选 ${task.confirmedProcIds.length} 件。`
}
