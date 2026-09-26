import { isQueryGuid } from '../query/query-validator'
import { buildQueryDependencies, sameQueryDependencies } from './query-dependency'
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
    if (!Array.isArray(task.queryDependencies)) {
      issues.push({ code: 'LEGACY_DEPENDENCY_UNKNOWN', message: '旧任务没有查询依赖快照，只能查看和只读诊断。', itemId: '' })
      const keepUnknown = task.status === 'UNKNOWN' || task.checkpoints.some(item => item.requestSent)
      return {
        ...task,
        issues,
        dependencyState: 'LEGACY_DEPENDENCY_UNKNOWN',
        readonly: true,
        status: keepUnknown ? 'UNKNOWN' : 'STALE',
        updatedAt: current.now ?? new Date().toISOString()
      }
    }
    if (task.queryDependencies.length > 0 && current.templates) {
      const liveDependencies = buildQueryDependencies(current.profiles, current.templates, task.queryDependencies.map(item => item.customerProfileId))
      if (!sameQueryDependencies(task.queryDependencies, liveDependencies)) {
        issues.push({ code: 'STALE_TASK', message: '查询模板或客户覆盖已经变化，旧计划已过期。', itemId: '' })
      }
    }
  }
  const sent = task.status === 'UNKNOWN' || task.readonly || task.checkpoints.some(item => item.requestSent)
  if (sent) return { ...task, issues, status: 'UNKNOWN', readonly: true, updatedAt: current.now ?? new Date().toISOString() }
  const stale = issues.some(item => item.code === 'STALE_TASK' || item.code === 'ACCOUNT_MISMATCH' || item.code === 'SESSION_USER')
  return { ...task, issues, status: stale ? 'STALE' : task.status, updatedAt: current.now ?? new Date().toISOString() }
}
