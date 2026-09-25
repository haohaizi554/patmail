import type { AutomationTask, StageId } from './types'

export type RecoveryAction = 'retry-read' | 'reread-mail' | 'reread-files' | 'reread-flow' | 'stop' | 'pending'

export function recoverTask(task: AutomationTask): { action: RecoveryAction; stage: StageId | ''; reason: string } {
  const sent = [...task.checkpoints].reverse().find(item => item.requestSent)
  if (!sent) return { action: 'retry-read', stage: '', reason: '还没有发出写请求，可以重新做只读规划。' }
  if (sent.stage === 'MAIL_CREATE') return { action: 'stop', stage: sent.stage, reason: '创建请求结果未知，禁止自动再次创建。' }
  if (sent.stage === 'MAIL_SAVE') return { action: 'reread-mail', stage: sent.stage, reason: '保存结果未知，先重新读取邮件。' }
  if (sent.stage === 'FILE_BIND') return { action: 'reread-files', stage: sent.stage, reason: '关联结果未知，先重新读取文件集合。' }
  if (sent.stage === 'WORKFLOW_SUBMIT') return { action: 'reread-flow', stage: sent.stage, reason: '流程提交结果未知，先重新读取流程和审核历史。' }
  if (sent.stage === 'REVIEW_EXECUTE') return { action: 'pending', stage: sent.stage, reason: '审核写接口尚未核对。' }
  return { action: 'stop', stage: sent.stage, reason: '写请求结果未知，不能自动重试。' }
}
