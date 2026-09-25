import type { CustomerQueryProfile } from '../customer/types'
import { selectionFingerprint } from '../mail/fingerprint'
import { planDrafts } from '../mail/planner'
import { planMailGroups } from '../mail/rules/grouping'
import type { MailRuleBundle, SelectedPatentFile } from '../mail/types'
import type { AutomationIssue, AutomationTask, AutomationTaskItem } from './types'

export interface TaskBuildInput {
  origin: string
  operatorId: string
  files: SelectedPatentFile[]
  rules: MailRuleBundle
  profiles: CustomerQueryProfile[]
  queryTemplateVersion: number
  now?: string
}

export function taskFingerprint(input: Pick<TaskBuildInput, 'origin' | 'operatorId' | 'files' | 'rules' | 'queryTemplateVersion'>): string {
  const selection = selectionFingerprint({ files: input.files, revision: input.rules.revision, userId: input.operatorId, origin: input.origin })
  return `${selection}\u001e${input.queryTemplateVersion}`
}

/** 指纹只在这里计算。调用方传入的指纹字符串不会被采用。 */
export function buildTask(input: TaskBuildInput): AutomationTask {
  const now = input.now ?? new Date().toISOString()
  const selection = selectionFingerprint({ files: input.files, revision: input.rules.revision, userId: input.operatorId, origin: input.origin })
  const fingerprint = taskFingerprint(input)
  const snapshot = { selectedAt: now, files: input.files, configVersion: input.rules.revision, userId: input.operatorId, origin: input.origin, fingerprint: selection }
  const drafts = planDrafts(snapshot, input.rules, input.profiles, input.operatorId)
  const grouped = planMailGroups(input.files, input.rules.policies)
  const taskId = `task-${fingerprint.slice(0, 24)}`
  const issues: AutomationIssue[] = grouped.skipped.map(item => ({ code: item.code, message: item.message, itemId: '' }))
  const items: AutomationTaskItem[] = drafts.map(draft => ({
    itemId: draft.id,
    taskId,
    customerProfileId: draft.customerProfileId,
    fileIds: [...draft.fileIds],
    fileNames: draft.files.map(file => file.fileName),
    fileDescriptionIdentity: draft.files[0]?.fileDescriptionId || draft.files[0]?.fileDescription || '',
    mailTypeId: draft.mailTypeId,
    mailTypeName: draft.mailTypeName,
    sendMode: draft.sendMode,
    mailDraftPreview: draft,
    easyMailId: '',
    mailExecutionId: '',
    workflowExecutionId: '',
    status: draft.status === 'ready' && draft.issues.every(issue => issue.severity !== 'error') ? 'DRY_RUN_COMPLETED' : 'BLOCKED',
    issues: draft.issues.map(issue => ({ code: issue.code, message: issue.message, itemId: draft.id }))
  }))
  for (const item of items) issues.push(...item.issues)
  const profile = input.profiles.find(item => item.id === items[0]?.customerProfileId)
  const warning = new Set(['UNRESOLVED_VARIABLE', 'SUBJECT_NEEDS_CONFIRM'])
  const blocked = items.length === 0 || items.some(item => item.status === 'BLOCKED') || issues.some(item => !warning.has(item.code))
  return {
    taskId, name: `${profile?.name || '未绑定客户'} · ${input.files.length} 个文件`,
    origin: input.origin, operatorId: input.operatorId,
    customerProfileId: profile?.id ?? '', customerName: profile?.name ?? '',
    selectionFingerprint: selection, taskFingerprint: fingerprint, selectedFiles: input.files.map(file => ({ ...file })),
    mailRuleRevision: input.rules.revision, queryTemplateVersion: input.queryTemplateVersion,
    mailGroups: grouped.groups, mailDrafts: drafts, status: blocked ? 'BLOCKED' : 'DRY_RUN_COMPLETED',
    createdAt: now, updatedAt: now, checkpoints: [], issues, items
  }
}
