import { reactive } from 'vue'

export type TaskCheckStatus = 'idle' | 'run' | 'done' | 'fail'

export const taskCheckProgress = reactive({
  visible: false,
  done: 0,
  total: 0,
  percent: 0,
  eta: '',
  status: 'idle' as TaskCheckStatus
})

export function resetTaskCheckProgress(): void {
  taskCheckProgress.visible = false
  taskCheckProgress.done = 0
  taskCheckProgress.total = 0
  taskCheckProgress.percent = 0
  taskCheckProgress.eta = ''
  taskCheckProgress.status = 'idle'
}

function clock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return time
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

/** 用已经对过的件数和开始时间，算出百分比和预计结束时刻。还没对上一件时不估时间。 */
export function taskCheckSnapshot(done: number, total: number, startedAt: number, now: number, status: TaskCheckStatus): { done: number; total: number; percent: number; eta: string } {
  const safeTotal = Math.max(0, Math.floor(total))
  const safeDone = Math.min(Math.max(0, Math.floor(done)), safeTotal)
  const percent = safeTotal ? Math.min(100, Math.round(safeDone / safeTotal * 1000) / 10) : 0
  if (status !== 'run' || safeDone <= 0 || safeDone >= safeTotal) return { done: safeDone, total: safeTotal, percent, eta: '' }
  const elapsed = now - startedAt
  if (elapsed < 800) return { done: safeDone, total: safeTotal, percent, eta: '' }
  return { done: safeDone, total: safeTotal, percent, eta: clock(now + elapsed / safeDone * (safeTotal - safeDone)) }
}

export function paintTaskCheckProgress(done: number, total: number, startedAt: number, status: TaskCheckStatus, now = Date.now()): void {
  const view = taskCheckSnapshot(done, total, startedAt, now, status)
  const visible = view.total > 0
  const bar = taskCheckProgress
  if (bar.visible === visible && bar.done === view.done && bar.total === view.total && bar.percent === view.percent && bar.eta === view.eta && bar.status === status) return
  bar.visible = visible
  bar.done = view.done
  bar.total = view.total
  bar.percent = view.percent
  bar.eta = view.eta
  bar.status = status
}
