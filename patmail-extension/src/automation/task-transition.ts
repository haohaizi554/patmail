import type { AutomationTask, AutomationTaskState } from './types'

export interface TaskTransition {
  from: AutomationTaskState
  event: string
  to: AutomationTaskState
  source: 'planner' | 'dry-run' | 'validator' | 'mail-execution' | 'workflow-execution'
  evidence: string
}

/** 可执行状态只能由对应领域服务发出的事件进入。页面声明不在这张表里。 */
export const TASK_TRANSITIONS: readonly TaskTransition[] = [
  { from: 'CREATED', event: 'DRY_RUN_FINISHED', to: 'DRY_RUN_COMPLETED', source: 'dry-run', evidence: '本地 Dry-run 结果' },
  { from: 'CREATED', event: 'PLAN_BLOCKED', to: 'BLOCKED', source: 'planner', evidence: '计划校验问题' },
  { from: 'DRY_RUN_COMPLETED', event: 'MARK_STALE', to: 'STALE', source: 'validator', evidence: '依赖或规则摘要变化' },
  { from: 'BLOCKED', event: 'MARK_STALE', to: 'STALE', source: 'validator', evidence: '依赖或规则摘要变化' },
  { from: 'READY', event: 'MARK_STALE', to: 'STALE', source: 'validator', evidence: '依赖或规则摘要变化' }
]

export function clientDeclaredExecution(task: {
  items?: Array<{ status?: string; easyMailId?: string; mailExecutionId?: string; workflowExecutionId?: string }>
  checkpoints?: Array<{ requestSent?: boolean; responseReceived?: boolean; verified?: boolean }>
  verifiedAt?: string
}): string {
  if (task.items?.some(item => item.status === 'COMPLETED' || item.status === 'UNKNOWN')) return '不能由页面声明子任务完成或未知。'
  if (task.checkpoints?.some(item => item.verified || item.responseReceived || item.requestSent)) return '不能由页面声明检查点已经核验或已经发送。'
  if (task.items?.some(item => item.easyMailId || item.mailExecutionId || item.workflowExecutionId)) return '不能由页面写入邮件或流程标识。'
  if (task.verifiedAt) return '不能由页面声明核验时间。'
  return ''
}

/** 已有执行证据不能在同一次写入里被清掉。 */
export function preservedEvidence(current: AutomationTask, next: AutomationTask): string {
  const locked = current.status === 'UNKNOWN' || current.status === 'RUNNING' || current.status === 'PARTIAL_FAILURE'
  if (locked && next.status !== current.status) return '不能覆盖已有执行证据。'
  const sent = (task: AutomationTask) => task.checkpoints.some(item => item.requestSent)
  if (sent(current) && !sent(next)) return '不能覆盖已有执行证据。'
  const verified = (task: AutomationTask) => task.checkpoints.some(item => item.verified)
  if (verified(current) && !verified(next)) return '不能覆盖已有执行证据。'
  const mailed = (task: AutomationTask) => task.items.some(item => item.easyMailId || item.workflowExecutionId)
  if (mailed(current) && !mailed(next)) return '不能覆盖已有执行证据。'
  return ''
}
