import { selectionFingerprint } from '../mail/fingerprint'
import { planDrafts } from '../mail/planner'
import { customerIdentities } from './snapshot'
import { buildTask, taskFingerprint, type TaskBuildInput } from './task-builder'
import { validateTask } from './task-validator'
import type { AutomationTask } from './types'

/** 后台自己读取规则和客户后生成任务。页面不能指定完成状态或指纹。 */
export function planTrustedTask(input: Omit<TaskBuildInput, 'queryTemplateVersion'>): AutomationTask {
  const full: TaskBuildInput = { ...input, queryTemplateVersion: 0 }
  const identities = customerIdentities(full.files, full.profiles)
  const fingerprint = taskFingerprint({ ...full, identities })
  const selection = selectionFingerprint({ files: full.files, revision: full.rules.revision, userId: full.operatorId, origin: full.origin })
  planDrafts({
    selectedAt: full.now ?? '',
    files: full.files,
    configVersion: full.rules.revision,
    userId: full.operatorId,
    origin: full.origin,
    fingerprint: selection
  }, full.rules, full.profiles, full.operatorId)
  const built = buildTask(full)
  if (built.taskFingerprint !== fingerprint) throw new Error('任务指纹未能由后台重算。')
  const checked = validateTask(built, full)
  for (const item of checked.items) {
    item.easyMailId = ''
    item.mailExecutionId = ''
    item.workflowExecutionId = ''
  }
  for (const point of checked.checkpoints) point.requestSent = false
  if (checked.status === 'COMPLETED' || checked.status === 'UNKNOWN') checked.status = 'BLOCKED'
  return checked
}
