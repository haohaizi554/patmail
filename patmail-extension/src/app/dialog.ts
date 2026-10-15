import { reactive } from 'vue'
import { downloadXlsxSheets } from '../customer/xlsx-table'

export interface DialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 警示框：标题居中标红，用来在提交前拦一下。 */
  warn?: boolean
  /** 逐行清单画成表格。短表整表展开，长表在框内滚动。 */
  table?: DialogTable
}

export interface DialogTable {
  headers?: string[]
  rows: string[][]
}

const state = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确定',
  cancelLabel: '取消',
  warn: false,
  table: null as DialogTable | null
})

let settle: ((confirmed: boolean) => void) | null = null

export interface ProgressLine {
  time: string
  text: string
}

export interface ProgressCounts {
  success: number
  failed: number
  abnormal: number
  skipped: number
}

export interface ProgressNote {
  kind: 'failed' | 'abnormal' | 'skipped'
  label: string
  reason: string
}

export const progressDialog = reactive({
  open: false,
  title: '',
  lines: [] as ProgressLine[],
  done: 0,
  total: 1,
  finished: false,
  counts: { success: 0, failed: 0, abnormal: 0, skipped: 0 } as ProgressCounts,
  notes: [] as ProgressNote[]
})

function progressClock(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function beginProgress(title: string, total: number): void {
  progressDialog.title = title
  progressDialog.lines = []
  progressDialog.done = 0
  progressDialog.total = Math.max(total, 1)
  progressDialog.finished = false
  progressDialog.counts.success = 0
  progressDialog.counts.failed = 0
  progressDialog.counts.abnormal = 0
  progressDialog.counts.skipped = 0
  progressDialog.notes = []
  progressDialog.open = true
}

/** 一封提交结果归到成功、失败、异常或跳过。对不上邮箱算异常，不用发是仲裁结论算跳过。 */
export function classifySubmitText(text: string): keyof ProgressCounts {
  if (text.startsWith('已提交')) return 'success'
  if (/对上邮箱|没有商务邮箱|没有客户联系人|没有案件联系人|对上了多个邮箱|没有可用的.+邮箱/.test(text)) return 'abnormal'
  if (/还在审核里|已经提交过|没有要提交|不用发，没有创建发文/.test(text)) return 'skipped'
  return 'failed'
}

export function tallyProgress(kind: keyof ProgressCounts, count = 1): void {
  if (count <= 0) return
  progressDialog.counts[kind] += count
}

/** 失败、异常、跳过记下文号和原因，结束时跟在件数后面。 */
export function noteProgress(kind: ProgressNote['kind'], label: string, reason: string): void {
  const text = reason.replace(/^没有提交到审核人。/, '').split('\n').map(item => item.trim()).filter(Boolean)[0] ?? ''
  progressDialog.notes.push({ kind, label: label.trim() || '这一件', reason: text.slice(0, 180) || '没有写明原因。' })
}

export function progressSummaryLine(): string {
  const counts = progressDialog.counts
  const parts = [`成功 ${counts.success} 件`, `失败 ${counts.failed} 件`, `异常 ${counts.abnormal} 件`]
  if (counts.skipped) parts.push(`跳过 ${counts.skipped} 件`)
  const head = `统计：${parts.join('，')}。`
  const names = { failed: '失败', abnormal: '异常', skipped: '跳过' } as const
  const details = progressDialog.notes.map(note => `${names[note.kind]} ${note.label}：${note.reason}`)
  return details.length ? `${head}${details.join('')}` : head
}

export function logProgress(line: string, done?: number): void {
  progressDialog.lines.push({ time: progressClock(), text: line })
  if (done === undefined) return
  const next = Math.min(progressDialog.total, Math.max(0, Math.round(done)))
  if (next > progressDialog.done) progressDialog.done = next
}

export function endProgress(): void {
  progressDialog.finished = true
  progressDialog.done = progressDialog.total
}

export function closeProgress(): void {
  if (!progressDialog.finished) return
  progressDialog.open = false
}

export function dialogState() {
  return state
}

/** 全站确认框。同一时间只开一个，后来的会关掉前一个。 */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
  if (settle) settle(false)
  state.title = options.title
  state.message = options.message
  state.confirmLabel = options.confirmLabel?.trim() || '确定'
  state.cancelLabel = options.cancelLabel === undefined ? '取消' : options.cancelLabel.trim()
  state.warn = options.warn === true
  state.table = options.table?.rows.length ? options.table : null
  state.open = true
  return new Promise(resolve => {
    settle = resolve
  })
}

/** 只读说明。遮罩、Esc 和「知道了」都是关掉。 */
export function infoDialog(options: Pick<DialogOptions, 'title' | 'message'>): Promise<boolean> {
  return confirmDialog({ ...options, confirmLabel: '知道了', cancelLabel: '' })
}

/** 全选时没有客户收件人，已先把业务邮箱写入收件人。提交结束后让用户核对。 */
export async function warnBusinessRecipients(rows: string[][]): Promise<void> {
  if (!rows.length) return
  await confirmDialog({
    title: `警示：${rows.length} 封已先写入业务邮箱`,
    message: '这些信的表格没有指定收件人，客户要求也没有指定发给谁。全选时发文规则里没有可勾选的客户联系人邮箱，已先把业务邮箱写入收件人。请在审核前认真核对，不该发给业务人员的要改掉。',
    table: { headers: ['案号', '收件人'], rows },
    confirmLabel: '知道了',
    cancelLabel: '',
    warn: true
  })
}

export function closeDialog(confirmed: boolean): void {
  if (!state.open) return
  state.open = false
  const done = settle
  settle = null
  done?.(confirmed)
}

/** 提交完成后整批结果的总结表。可滚动核对，可导出成 xlsx。 */
export const summaryDialog = reactive({
  open: false,
  title: '',
  headers: [] as string[],
  rows: [] as string[][],
  exportName: ''
})

/** 总结表里的公司名最多 15 个字，再长就省略。 */
export function clipCompany(name: string | undefined): string {
  const text = name?.trim() || '表格里没有'
  return text.length > 15 ? `${text.slice(0, 15)}…` : text
}

export function openSummary(title: string, headers: string[], rows: string[][], exportName: string): void {
  summaryDialog.title = title
  summaryDialog.headers = [...headers]
  summaryDialog.rows = rows.map(row => [...row])
  summaryDialog.exportName = exportName
  summaryDialog.open = true
}

export function closeSummary(): void {
  summaryDialog.open = false
}

export function exportSummary(): void {
  if (!summaryDialog.rows.length) return
  const name = summaryDialog.exportName || '提交总结.xlsx'
  downloadXlsxSheets([{ name: '提交总结', rows: [summaryDialog.headers, ...summaryDialog.rows] }], name)
}
