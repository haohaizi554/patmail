import { taskFingerprint } from './task-builder'
import type { AutomationTask, AutomationTaskState } from './types'

const CLIENT_STATUS = new Set<AutomationTaskState>([
  'CREATED', 'READY', 'DRY_RUN_COMPLETED', 'BLOCKED', 'STALE', 'FAILED', 'CANCELLED', 'PARTIAL_FAILURE',
  'PAUSED', 'WAITING_USER', 'CONFIRM_REQUIRED', 'QUEUED'
])

/** 页面送来的任务不能自带完成、未知或执行标识。指纹必须能由任务内容重算。 */
export function clientTaskRejection(task: AutomationTask): string {
  if (!task || !Array.isArray(task.items) || !Array.isArray(task.checkpoints) || !Array.isArray(task.selectedFiles) || !task.ruleSnapshot || !Array.isArray(task.identitySnapshot)) {
    return '任务结构不完整，不能直接保存。'
  }
  if (task.status === 'COMPLETED' || task.status === 'UNKNOWN') return '不能由页面声明任务完成或未知。'
  if (!CLIENT_STATUS.has(task.status)) return '任务状态不在后台允许的范围内。'
  if (task.checkpoints.some(item => item.requestSent)) return '不能由页面声明请求已发出。'
  if (task.items.some(item => item.easyMailId || item.workflowExecutionId || item.mailExecutionId)) return '不能由页面写入邮件或流程标识。'
  const rebuilt = taskFingerprint({
    origin: task.origin,
    operatorId: task.operatorId,
    files: task.selectedFiles,
    rules: task.ruleSnapshot,
    queryTemplateVersion: task.queryTemplateVersion,
    identities: task.identitySnapshot
  })
  if (rebuilt !== task.taskFingerprint) return '任务指纹与业务内容不一致。'
  return ''
}
