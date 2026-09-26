import { isQueryGuid } from '../query/query-validator'
import { customerIdentities } from './snapshot'
import { taskFingerprint, type TaskBuildInput } from './task-builder'
import type { AutomationTask } from './types'

export function validateTask(task: AutomationTask, current: TaskBuildInput): AutomationTask {
  const issues = [...task.issues]
  if (task.origin !== current.origin || task.operatorId !== current.operatorId) {
    issues.push({ code: 'ACCOUNT_MISMATCH', message: '任务不能跨账号或跨站点复用。', itemId: '' })
  }
  if (!isQueryGuid(current.operatorId)) issues.push({ code: 'SESSION_USER', message: '当前用户身份失效。', itemId: '' })
  if (!task.ruleSnapshot || !Array.isArray(task.identitySnapshot)) {
    issues.push({ code: 'STALE_TASK', message: '旧任务没有规则快照，只能只读。', itemId: '' })
  } else {
    const frozen = taskFingerprint({
      origin: task.origin, operatorId: task.operatorId, files: task.selectedFiles,
      rules: task.ruleSnapshot, queryTemplateVersion: task.queryTemplateVersion,
      identities: task.identitySnapshot
    })
    const live = taskFingerprint({ ...current, identities: customerIdentities(current.files, current.profiles) })
    if (frozen !== live || task.taskFingerprint !== frozen) {
      issues.push({ code: 'STALE_TASK', message: '文件、客户绑定或规则内容已经变化，需要重新生成计划。', itemId: '' })
    }
  }
  const sent = task.status === 'UNKNOWN' || task.readonly || task.checkpoints.some(item => item.requestSent)
  if (sent) return { ...task, issues, status: 'UNKNOWN', readonly: true, updatedAt: current.now ?? new Date().toISOString() }
  const stale = issues.some(item => item.code === 'STALE_TASK' || item.code === 'ACCOUNT_MISMATCH' || item.code === 'SESSION_USER')
  return { ...task, issues, status: stale ? 'STALE' : task.status, updatedAt: current.now ?? new Date().toISOString() }
}
