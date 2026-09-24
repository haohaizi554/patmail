import type { MailDraftPreview, ValidationIssue } from '../types'

export function validateDraft(draft: Omit<MailDraftPreview, 'status' | 'issues'> & { issues?: ValidationIssue[] }): ValidationIssue[] {
  const issues = [...(draft.issues ?? [])]
  const add = (code: string, severity: ValidationIssue['severity'], message: string, field: string) => {
    issues.push({ code, severity, message, field, draftId: draft.id })
  }
  if (draft.fileIds.length === 0 || draft.fileIds.some(id => !id.trim())) add('MISSING_FILE_ID', 'error', '草稿缺少有效文件 ID。', 'fileIds')
  if (new Set(draft.fileIds).size !== draft.fileIds.length) add('DUPLICATE_FILE', 'error', '草稿包含重复文件。', 'fileIds')
  const profiles = new Set(draft.files.map(file => file.customerProfileId?.trim() ?? ''))
  const sameProfile = profiles.size === 1 && !profiles.has('')
  const customers = new Set(draft.files.map(file => file.customerId?.trim() || file.customerProfileId?.trim() || ''))
  if (!sameProfile && (customers.size !== 1 || customers.has(''))) add('CROSS_CUSTOMER', 'error', '草稿不能跨客户合并。', 'customer')
  if (!draft.customerProfileId) add('MISSING_CUSTOMER', 'error', '客户身份不明确。', 'customer')
  if (draft.files.some(file => !file.fileDescription.trim() && !file.fileDescriptionId)) add('MISSING_DESCRIPTION', 'error', '文件描述不明确。', 'description')
  if (!draft.mailTypeId) add('MISSING_MAPPING', 'error', '缺少发文类型映射。', 'mailType')
  if (draft.to.length === 0) add('MISSING_RECIPIENT', 'error', '收件人为空。', 'to')
  if (!draft.subject.trim()) add('EMPTY_SUBJECT', 'error', '邮件主题为空。', 'subject')
  return issues
}

export function statusFrom(issues: ValidationIssue[]): MailDraftPreview['status'] {
  if (issues.some(issue => issue.severity === 'error')) return 'blocked'
  if (issues.length > 0) return 'warning'
  return 'ready'
}
