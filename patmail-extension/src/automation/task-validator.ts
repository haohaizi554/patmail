import { isQueryGuid } from '../query/query-validator'
import { taskFingerprint, type TaskBuildInput } from './task-builder'
import type { AutomationTask } from './types'

export function validateTask(task: AutomationTask, current: TaskBuildInput): AutomationTask {
  const issues = [...task.issues]
  if (task.origin !== current.origin || task.operatorId !== current.operatorId) {
    issues.push({ code: 'ACCOUNT_MISMATCH', message: '任务不能跨账号或跨站点复用。', itemId: '' })
  }
  if (!isQueryGuid(current.operatorId)) issues.push({ code: 'SESSION_USER', message: '当前用户身份失效。', itemId: '' })
  const frozen = taskFingerprint({
    origin: task.origin, operatorId: task.operatorId, files: task.selectedFiles,
    rules: { ...current.rules, revision: task.mailRuleRevision }, queryTemplateVersion: task.queryTemplateVersion
  })
  const live = taskFingerprint(current)
  if (frozen !== live || task.taskFingerprint !== frozen || current.rules.revision !== task.mailRuleRevision || current.queryTemplateVersion !== task.queryTemplateVersion) {
    issues.push({ code: 'STALE_TASK', message: '文件、客户绑定或规则版本已经变化，需要重新生成计划。', itemId: '' })
  }
  const stale = issues.some(item => item.code === 'STALE_TASK' || item.code === 'ACCOUNT_MISMATCH' || item.code === 'SESSION_USER')
  return { ...task, issues, status: stale ? 'STALE' : task.status, updatedAt: current.now ?? new Date().toISOString() }
}
