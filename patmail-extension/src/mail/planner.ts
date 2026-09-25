import type { CustomerQueryProfile } from '../customer/types'
import { selectionFingerprint } from './fingerprint'
import { resolveMailType } from './rules/description-mapping'
import { planMailGroups } from './rules/grouping'
import { resolveRecipients, uniqueAddresses } from './rules/recipient-resolver'
import { buildSubject } from './rules/subject-builder'
import { buildBody } from './rules/body-builder'
import { statusFrom, validateDraft } from './rules/validator'
import type { MailDraftPreview, MailRuleBundle, SelectionSnapshot, ValidationIssue } from './types'

function customerName(profileId: string, profiles: CustomerQueryProfile[]): string {
  return profiles.find(item => item.id === profileId)?.name ?? ''
}

/** 只在本地计算草稿，不会在 EASY 创建邮件。 */
export function planDrafts(snapshot: SelectionSnapshot, rules: MailRuleBundle, profiles: CustomerQueryProfile[], operatorId: string): MailDraftPreview[] {
  const fingerprint = selectionFingerprint({
    files: snapshot.files, revision: rules.revision, userId: snapshot.userId, origin: snapshot.origin
  })
  const staleSnapshot = snapshot.fingerprint !== fingerprint
  const grouped = planMailGroups(snapshot.files, rules.policies)
  const drafts: MailDraftPreview[] = grouped.groups.map(group => {
    const resolved = resolveMailType(group, rules.mappings)
    const mapping = resolved.mapping
    const policy = rules.policies.find(item => item.customerProfileId === group.customerProfileId && item.enabled)
    const recipient = resolveRecipients(group.customerProfileId, rules.recipients, policy?.recipientTemplateId)
    const to = recipient ? uniqueAddresses(recipient.to) : { addresses: [], invalid: [] as string[] }
    const cc = recipient ? uniqueAddresses(recipient.cc) : { addresses: [], invalid: [] as string[] }
    const signature = rules.signatures.find(item => item.enabled && item.isDefault && item.operatorId === operatorId)
    const name = customerName(group.customerProfileId, profiles)
    const subject = buildSubject(rules.subject, group, name)
    const body = buildBody(rules.body, group, name, signature?.content ?? '')
    const issues: ValidationIssue[] = []
    for (const address of [...to.invalid, ...cc.invalid]) {
      issues.push({ code: 'INVALID_EMAIL', severity: 'error', message: `邮箱格式无效：${address}`, field: 'to', draftId: group.id })
    }
    for (const variable of [...subject.unresolved, ...body.unresolved]) {
      issues.push({ code: 'UNRESOLVED_VARIABLE', severity: 'warning', message: `变量 {${variable}} 没有对应数据。`, field: 'template', draftId: group.id })
    }
    if (subject.needsConfirm) {
      issues.push({ code: 'SUBJECT_NEEDS_CONFIRM', severity: 'warning', message: '标题里没有配置的锚点，需要人工确认。', field: 'subject', draftId: group.id })
    }
    if (resolved.conflict) {
      issues.push({ code: 'MAPPING_CONFLICT', severity: 'error', message: '同一文件描述存在多个发文类型映射。', field: 'mailType', draftId: group.id })
    }
    if (rules.revision !== snapshot.configVersion || staleSnapshot) {
      issues.push({ code: 'STALE_RULE', severity: 'error', message: '预览已经失效，不能继续创建邮件。', field: 'version', draftId: group.id })
    }
    const base = {
      id: group.id,
      customerProfileId: group.customerProfileId,
      fileIds: group.files.map(file => file.fileId),
      files: group.files.map(file => ({ ...file })),
      mailTypeId: resolved.conflict ? '' : mapping?.mailTypeId ?? '',
      mailTypeName: mapping?.mailTypeName ?? '',
      to: to.addresses,
      cc: cc.addresses,
      subject: subject.text,
      body: body.text,
      signature: signature?.content ?? '',
      sendMode: group.sendMode,
      ruleVersions: {
        policy: group.policyVersion,
        mapping: mapping?.version ?? 0,
        recipient: recipient?.version ?? 0,
        signature: signature?.version ?? 0,
        subject: rules.subject.version,
        body: rules.body.version
      },
      fingerprint
    }
    const allIssues = validateDraft({ ...base, issues })
    return { ...base, issues: allIssues, status: statusFrom(allIssues) }
  })
  for (const skipped of grouped.skipped) {
    const id = `blocked:${skipped.file.fileId || 'missing'}`
    const issues: ValidationIssue[] = [{ code: skipped.code, severity: 'error', message: skipped.message, field: 'file', draftId: id }]
    drafts.push({
      id, customerProfileId: skipped.file.customerProfileId ?? '', fileIds: skipped.file.fileId ? [skipped.file.fileId] : [],
      files: [skipped.file], mailTypeId: '', mailTypeName: '', to: [], cc: [], subject: '', body: '', signature: '',
      sendMode: 'single_file', status: 'blocked', issues, ruleVersions: { subject: rules.subject.version, body: rules.body.version }, fingerprint
    })
  }
  return drafts
}
