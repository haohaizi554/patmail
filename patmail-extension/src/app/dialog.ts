import { reactive } from 'vue'

export interface DialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}

const state = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确定',
  cancelLabel: '取消'
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

export const progressDialog = reactive({
  open: false,
  title: '',
  lines: [] as ProgressLine[],
  done: 0,
  total: 1,
  finished: false,
  counts: { success: 0, failed: 0, abnormal: 0, skipped: 0 } as ProgressCounts
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
  progressDialog.open = true
}

/** 一封提交结果归到成功、失败、异常或跳过。对不上邮箱算异常。 */
export function classifySubmitText(text: string): keyof ProgressCounts {
  if (text.startsWith('已提交')) return 'success'
  if (/对上邮箱|没有商务邮箱|没有客户联系人|没有案件联系人|对上了多个邮箱|没有可用的.+邮箱/.test(text)) return 'abnormal'
  if (/还在审核里|已经提交过|没有要提交/.test(text)) return 'skipped'
  return 'failed'
}

export function tallyProgress(kind: keyof ProgressCounts, count = 1): void {
  if (count <= 0) return
  progressDialog.counts[kind] += count
}

export function progressSummaryLine(): string {
  const counts = progressDialog.counts
  const parts = [`成功 ${counts.success} 件`, `失败 ${counts.failed} 件`, `异常 ${counts.abnormal} 件`]
  if (counts.skipped) parts.push(`跳过 ${counts.skipped} 件`)
  return `统计：${parts.join('，')}。`
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
  state.open = true
  return new Promise(resolve => {
    settle = resolve
  })
}

/** 只读说明。遮罩、Esc 和「知道了」都是关掉。 */
export function infoDialog(options: Pick<DialogOptions, 'title' | 'message'>): Promise<boolean> {
  return confirmDialog({ ...options, confirmLabel: '知道了', cancelLabel: '' })
}

export function closeDialog(confirmed: boolean): void {
  if (!state.open) return
  state.open = false
  const done = settle
  settle = null
  done?.(confirmed)
}
