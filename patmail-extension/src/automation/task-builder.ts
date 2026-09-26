import type { CustomerQueryProfile } from '../customer/types'
import { selectionFingerprint } from '../mail/fingerprint'
import { planDrafts } from '../mail/planner'
import { planMailGroups } from '../mail/rules/grouping'
import type { MailRuleBundle, SelectedPatentFile } from '../mail/types'
import { sha256Hex } from './sha256'
import { customerIdentities, createTaskSnapshot, emptyIdentity } from './snapshot'
import type { AutomationIssue, AutomationTask, AutomationTaskItem, CustomerIdentitySnapshot, TaskCustomer } from './types'

export interface TaskBuildInput {
  origin: string
  operatorId: string
  files: SelectedPatentFile[]
  rules: MailRuleBundle
  profiles: CustomerQueryProfile[]
  queryTemplateVersion: number
  now?: string
}

function byText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
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
export function taskFingerprint(input: Pick<TaskBuildInput, 'origin' | 'operatorId' | 'files' | 'rules' | 'queryTemplateVersion'> & {
  profiles?: TaskBuildInput['profiles']
  identities?: CustomerIdentitySnapshot[]
}): string {
  const identities = input.identities ?? customerIdentities(input.files, input.profiles ?? [])
  const files = [...input.files].sort((left, right) => byText(left.fileId, right.fileId))
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
    identities,
    policies: [...rules.policies].sort((left, right) => byText(left.customerProfileId, right.customerProfileId) || byText(left.sendMode, right.sendMode))
      .map(item => ({ customerProfileId: item.customerProfileId, sendMode: item.sendMode, enabled: item.enabled, version: item.version })),
    mappings: [...rules.mappings].sort((left, right) => byText(left.fileDescriptionId ?? left.fileDescriptionText ?? '', right.fileDescriptionId ?? right.fileDescriptionText ?? '') || byText(left.mailTypeId, right.mailTypeId) || byText(left.id, right.id))
      .map(item => ({ id: item.id, fileDescriptionId: item.fileDescriptionId ?? '', fileDescriptionText: item.fileDescriptionText ?? '', mailTypeId: item.mailTypeId, mailTypeName: item.mailTypeName, enabled: item.enabled, version: item.version })),
    recipients: [...rules.recipients].sort((left, right) => byText(left.customerProfileId, right.customerProfileId) || byText(left.id, right.id) || byText(left.name, right.name))
      .map(item => ({ id: item.id, customerProfileId: item.customerProfileId, name: item.name, to: [...item.to], cc: [...item.cc], enabled: item.enabled, isDefault: item.isDefault, version: item.version })),
    signatures: [...rules.signatures].sort((left, right) => byText(left.id, right.id) || byText(left.operatorId, right.operatorId))
      .map(item => ({ operatorId: item.operatorId, name: item.name, content: item.content, enabled: item.enabled, isDefault: item.isDefault, version: item.version })),
    subject: { template: rules.subject.template, countInjection: rules.subject.countInjection, anchor: rules.subject.anchor, missingAnchor: rules.subject.missingAnchor, version: rules.subject.version },
    body: { template: rules.body.template, supplement: rules.body.supplement, version: rules.body.version }
  })
  return sha256Hex(canonical)
}

/** 指纹只在这里计算。调用方传入的指纹字符串不会被采用。 */
export function buildTask(input: TaskBuildInput): AutomationTask {
  const now = input.now ?? new Date().toISOString()
  const files = createTaskSnapshot(input.files)
  const rules = createTaskSnapshot(input.rules)
  const profiles = createTaskSnapshot(input.profiles)
  const identities = customerIdentities(files, profiles)
  const frozen: TaskBuildInput = { ...input, files, rules, profiles }
  const selection = selectionFingerprint({ files, revision: rules.revision, userId: input.operatorId, origin: input.origin })
  const fingerprint = taskFingerprint({ ...frozen, identities })
  const snapshot = { selectedAt: now, files, configVersion: rules.revision, userId: input.operatorId, origin: input.origin, fingerprint: selection }
  const drafts = planDrafts(snapshot, rules, profiles, input.operatorId)
  const grouped = planMailGroups(files, rules.policies)
  const taskId = globalThis.crypto.randomUUID()
  const issues: AutomationIssue[] = grouped.skipped.map(item => ({ code: item.code, message: item.message, itemId: '' }))
  const items: AutomationTaskItem[] = drafts.map(draft => ({
    itemId: draft.id,
    taskId,
    customerProfileId: draft.customerProfileId,
    customerIdentity: identities.find(item => item.profileId === draft.customerProfileId) ?? emptyIdentity(),
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
    const profile = profiles.find(profile => profile.id === item.customerProfileId)
    return [item.customerProfileId, { id: item.customerProfileId, name: profile?.name || item.customerProfileId }] as const
  })).values()]
  const warning = new Set(['UNRESOLVED_VARIABLE', 'SUBJECT_NEEDS_CONFIRM'])
  const blocked = items.length === 0 || items.some(item => item.status === 'BLOCKED') || issues.some(item => !warning.has(item.code))
  const sole = customers.length === 1 ? customers[0] : undefined
  return {
    taskId, name: `${customers.length > 1 ? '多个客户' : sole?.name || '未绑定客户'} · ${input.files.length} 个文件`,
    origin: input.origin, operatorId: input.operatorId,
    customerProfileId: sole?.id ?? '', customerName: customers.length > 1 ? '多个客户' : sole?.name ?? '',
    customers, identitySnapshot: identities, legacyTaskId: '', archived: false, readonly: false,
    ruleSnapshot: rules, verifiedAt: '',
    selectionFingerprint: selection, taskFingerprint: fingerprint, selectedFiles: files,
    mailRuleRevision: rules.revision, queryTemplateVersion: input.queryTemplateVersion,
    mailGroups: grouped.groups, mailDrafts: drafts, status: blocked ? 'BLOCKED' : 'DRY_RUN_COMPLETED',
    createdAt: now, updatedAt: now, checkpoints: [], issues, items
  }
}
