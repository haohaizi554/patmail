export interface AgentTraceStep {
  label: string
  detail: string
  state: 'run' | 'done'
}

export interface ActivityEvent {
  label: string
  phase: 'run' | 'done'
  detail?: string
}

/** 工具原文只留第一行，给浮窗的过程列表用。 */
export function activityDetail(text: string): string {
  const line = text.split('\n').map(item => item.trim()).find(Boolean) ?? ''
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/** 把活动消息收成一条过程。新的一步开始时，上一步视为已经结束。 */
export function foldActivity(steps: readonly AgentTraceStep[], event: ActivityEvent): AgentTraceStep[] {
  const label = event.label.trim().slice(0, 40)
  if (!label) return steps.slice()
  const detail = (event.detail ?? '').trim().slice(0, 180)
  const next = steps.map(step => ({ ...step }))
  if (event.phase === 'done') {
    const open = [...next].reverse().find(step => step.label === label && step.state === 'run')
    if (open) {
      open.detail = detail
      open.state = 'done'
      return next
    }
    const early = [...next].reverse().find(step => step.label === label && step.state === 'done' && !step.detail)
    if (early && detail) {
      early.detail = detail
      return next
    }
    next.push({ label, detail, state: 'done' })
    return next
  }
  const last = next.at(-1)
  if (last?.state === 'run' && last.label === label) return next
  if (last?.state === 'run') last.state = 'done'
  next.push({ label, detail: '', state: 'run' })
  return next
}
