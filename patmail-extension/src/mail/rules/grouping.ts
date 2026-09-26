import type { CustomerMailPolicy, MailGroup, SelectedPatentFile, SendMode } from '../types'

export interface GroupingResult {
  groups: MailGroup[]
  skipped: Array<{ file: SelectedPatentFile; code: string; message: string }>
}

function identity(file: SelectedPatentFile): { customer: string; description: string; label: string } | null {
  const binding = file.customerBinding
  const confirmed = binding?.confirmed === true && binding.profileId.trim() && binding.profileId === file.customerProfileId?.trim()
  const easy = (file.customerId ?? '').trim()
  const customer = confirmed
    ? `profile:${binding.profileId.trim()}|easy:${easy}|source:${binding.sourceCustomerName.trim()}`
    : ''
  const description = file.fileDescriptionId?.trim()
    ? `id:${file.fileDescriptionId.trim()}`
    : file.fileDescription.trim() ? `text:${file.fileDescription.trim()}` : ''
  if (!customer || !description) return null
  return { customer, description, label: file.fileDescription.trim() || file.fileDescriptionId || '' }
}

function modeFor(file: SelectedPatentFile, policies: CustomerMailPolicy[]): { mode: SendMode; version: number; profileId: string } | null {
  const profileId = file.customerProfileId?.trim() ?? ''
  const policy = policies.find(item => item.enabled && item.customerProfileId === profileId)
  if (!policy || !profileId) return null
  return { mode: policy.sendMode, version: policy.version, profileId }
}

/** 同客户且同文件描述才合并。未知客户或空描述不并入任何组。 */
export function planMailGroups(files: SelectedPatentFile[], policies: CustomerMailPolicy[]): GroupingResult {
  const groups: MailGroup[] = []
  const skipped: GroupingResult['skipped'] = []
  const seen = new Set<string>()
  const ordered = [...files].sort((left, right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0)
  for (const file of ordered) {
    if (!file.fileId.trim()) {
      skipped.push({ file, code: 'MISSING_FILE_ID', message: '文件缺少 ID，不能自动规划。' })
      continue
    }
    if (seen.has(file.fileId)) {
      skipped.push({ file, code: 'DUPLICATE_FILE', message: '同一文件不会重复加入草稿。' })
      continue
    }
    seen.add(file.fileId)
    const key = identity(file)
    if (!key) {
      const hasCustomer = Boolean(file.customerBinding?.confirmed && file.customerProfileId)
      skipped.push({ file, code: hasCustomer ? 'MISSING_DESCRIPTION' : 'MISSING_CUSTOMER', message: hasCustomer ? '文件描述为空，不能自动分组。' : '客户身份尚未确认，不能自动合并。' })
      continue
    }
    const policy = modeFor(file, policies)
    if (!policy) {
      skipped.push({ file, code: 'MISSING_POLICY', message: '该客户没有启用的发文方式。' })
      continue
    }
    const groupId = policy.mode === 'single_file'
      ? `single:${policy.profileId}:${file.fileId}`
      : `merge:${key.customer}:${key.description}`
    const existing = groups.find(group => group.id === groupId)
    if (existing) existing.files.push(file)
    else groups.push({
      id: groupId,
      customerProfileId: policy.profileId,
      customerIdentity: key.customer,
      descriptionIdentity: key.description,
      descriptionLabel: key.label,
      sendMode: policy.mode,
      files: [file],
      policyVersion: policy.version
    })
  }
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
  groups.sort((left, right) => compare(left.customerIdentity, right.customerIdentity) ||
    compare(left.descriptionIdentity, right.descriptionIdentity) || compare(left.id, right.id))
  for (const group of groups) group.files.sort((left, right) => compare(left.fileId, right.fileId))
  return { groups, skipped }
}
