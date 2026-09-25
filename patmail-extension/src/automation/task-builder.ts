import type { CustomerQueryProfile } from '../customer/types'
import { selectionFingerprint } from '../mail/fingerprint'
import { planDrafts } from '../mail/planner'
import { planMailGroups } from '../mail/rules/grouping'
import type { MailRuleBundle, SelectedPatentFile } from '../mail/types'
import { sha256Hex } from './sha256'
import type { AutomationIssue, AutomationTask, AutomationTaskItem, TaskCustomer } from './types'

export interface TaskBuildInput {
  origin: string
  operatorId: string
  files: SelectedPatentFile[]
  rules: MailRuleBundle
  profiles: CustomerQueryProfile[]
  queryTemplateVersion: number
  now?: string
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 指纹覆盖规则内容本身，不只看 revision。字段顺序和文件顺序都先规范化。 */
export function taskFingerprint(input: Pick<TaskBuildInput, 'origin' | 'operatorId' | 'files' | 'rules' | 'queryTemplateVersion'>): string {
  const files = [...input.files].sort((left, right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0)
    .map(file => ({
      fileId: file.fileId, fileName: file.fileName, fileDescription: file.fileDescription,
      fileDescriptionId: file.fileDescriptionId ?? '', customerName: file.customerName,
      customerProfileId: file.customerProfileId ?? '', customerId: file.customerId ?? '',
      binding: file.customerBinding ? {
        profileId: file.customerBinding.profileId, confirmed: file.customerBinding.confirmed,
        sourceCustomerName: file.customerBinding.sourceCustomerName
      } : null
    }))
  const rules = input.rules
  const canonical = stable({
    origin: input.origin,
    operatorId: input.operatorId,
    queryTemplateVersion: input.queryTemplateVersion,
    files,
    revision: rules.revision,
    policies: [...rules.policies].sort((left, right) => left.customerProfileId < right.customerProfileId ? -1 : 1)
      .map(item => ({ customerProfileId: item.customerProfileId, sendMode: item.sendMode, enabled: item.enabled, version: item.version })),
    mappings: [...rules.mappings].sort((left, right) => (left.fileDescriptionId ?? left.fileDescriptionText ?? '') < (right.fileDescriptionId ?? right.fileDescriptionText ?? '') ? -1 : 1)
      .map(item => ({ fileDescriptionId: item.fileDescriptionId ?? '', fileDescriptionText: item.fileDescriptionText ?? '', mailTypeId: item.mailTypeId, mailTypeName: item.mailTypeName, enabled: item.enabled, version: item.version })),
    recipients: [...rules.recipients].sort((left, right) => left.customerProfileId < right.customerProfileId ? -1 : 1)
      .map(item => ({ customerProfileId: item.customerProfileId, to: [...item.to], cc: [...item.cc], enabled: item.enabled, isDefault: item.isDefault, version: item.version })),
    signatures: [...rules.signatures].sort((left, right) => left.id < right.id ? -1 : 1)
      .map(item => ({ operatorId: item.operatorId, name: item.name, content: item.content, enabled: item.enabled, isDefault: item.isDefault, version: item.version })),
    subject: { template: rules.subject.template, countInjection: rules.subject.countInjection, anchor: rules.subject.anchor, missingAnchor: rules.subject.missingAnchor, version: rules.subject.version },
    body: { template: rules.body.template, supplement: rules.body.supplement, version: rules.body.version }
  })
  return sha256Hex(canonical)
}

/** 指纹只在这里计算。调用方传入的指纹字符串不会被采用。 */
export function buildTask(input: TaskBuildInput): AutomationTask {
  const now = input.now ?? new Date().toISOString()
  const selection = selectionFingerprint({ files: input.files, revision: input.rules.revision, userId: input.operatorId, origin: input.origin })
  const fingerprint = taskFingerprint(input)
  const snapshot = { selectedAt: now, files: input.files, configVersion: input.rules.revision, userId: input.operatorId, origin: input.origin, fingerprint: selection }
  const drafts = planDrafts(snapshot, input.rules, input.profiles, input.operatorId)
  const grouped = planMailGroups(input.files, input.rules.policies)
  const taskId = globalThis.crypto.randomUUID()
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
  const customers: TaskCustomer[] = [...new Map(items.filter(item => item.customerProfileId).map(item => {
    const profile = input.profiles.find(profile => profile.id === item.customerProfileId)
    return [item.customerProfileId, { id: item.customerProfileId, name: profile?.name || item.customerProfileId }] as const
  })).values()]
  const warning = new Set(['UNRESOLVED_VARIABLE', 'SUBJECT_NEEDS_CONFIRM'])
  const blocked = items.length === 0 || items.some(item => item.status === 'BLOCKED') || issues.some(item => !warning.has(item.code))
  const sole = customers.length === 1 ? customers[0] : undefined
  return {
    taskId, name: `${customers.length > 1 ? '多个客户' : sole?.name || '未绑定客户'} · ${input.files.length} 个文件`,
    origin: input.origin, operatorId: input.operatorId,
    customerProfileId: sole?.id ?? '', customerName: customers.length > 1 ? '多个客户' : sole?.name ?? '',
    customers, legacyTaskId: '', archived: false, readonly: false,
    ruleSnapshot: input.rules, verifiedAt: '',
    selectionFingerprint: selection, taskFingerprint: fingerprint, selectedFiles: input.files.map(file => ({ ...file })),
    mailRuleRevision: input.rules.revision, queryTemplateVersion: input.queryTemplateVersion,
    mailGroups: grouped.groups, mailDrafts: drafts, status: blocked ? 'BLOCKED' : 'DRY_RUN_COMPLETED',
    createdAt: now, updatedAt: now, checkpoints: [], issues, items
  }
}
