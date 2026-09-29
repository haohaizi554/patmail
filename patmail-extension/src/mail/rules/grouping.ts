import { isQueryGuid } from '../../query/query-validator'
import type { CustomerMailPolicy, DescriptionMailTypeMapping, MailGroup, SelectedPatentFile, SendMode } from '../types'
import { policyRemark } from './customer-policy'
import { mappingKey } from './description-mapping'

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

function modeFor(
  file: SelectedPatentFile,
  policies: CustomerMailPolicy[],
  mappings: DescriptionMailTypeMapping[]
): { mode: SendMode; version: number; profileId: string; remark: string } | null {
  const profileId = file.customerProfileId?.trim() ?? ''
  const matches = policies.filter(item => item.enabled && item.customerProfileId === profileId && item.querySurface !== 'limit' && (item.sendMode === 'merge_by_customer_description' || item.sendMode === 'single_file'))
  if (!profileId || matches.length === 0) return null
  const only = matches[0]
  if (matches.length === 1 && only?.sendMode) {
    return { mode: only.sendMode, version: only.version, profileId, remark: policyRemark(only.remark) }
  }
  const description = file.fileDescriptionId?.trim()
    ? `id:${file.fileDescriptionId.trim()}`
    : file.fileDescription.trim() ? `text:${file.fileDescription.trim()}` : ''
  const mapped = mappings.filter(item => item.enabled && isQueryGuid(item.mailTypeId) && mappingKey(item) === description)
  const mappedPolicies = mapped.length === 1
    ? matches.filter(item => item.mailTypeId === mapped[0]?.mailTypeId && item.sendMode)
    : []
  const mappedPolicy = mappedPolicies.length === 1 ? mappedPolicies[0] : undefined
  if (mappedPolicy?.sendMode) {
    return { mode: mappedPolicy.sendMode, version: mappedPolicy.version, profileId, remark: policyRemark(mappedPolicy.remark) }
  }
  const modes = [...new Set(matches.flatMap(item => item.sendMode ? [item.sendMode] : []))]
  const remarks = new Set(matches.map(item => policyRemark(item.remark)))
  if (modes.length === 1 && modes[0] && remarks.size <= 1) {
    const newest = matches.reduce((best, item) => item.version > best.version ? item : best)
    return { mode: modes[0], version: newest.version, profileId, remark: policyRemark(newest.remark) }
  }
  return null
}

/** 文件管理里，同客户且同文件描述才合并。发文方式取这个查询方式下保存的那一种；有多种时，用文件描述对上的发文类型来区分。 */
export function planMailGroups(files: SelectedPatentFile[], policies: CustomerMailPolicy[], mappings: DescriptionMailTypeMapping[] = []): GroupingResult {
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
    const policy = modeFor(file, policies, mappings)
    if (!policy) {
      const sets = policies.filter(item => item.enabled && item.customerProfileId === file.customerProfileId && item.querySurface !== 'limit')
      const remarks = new Set(sets.map(item => policyRemark(item.remark)))
      skipped.push({
        file,
        code: sets.length > 1 ? 'AMBIGUOUS_POLICY' : 'MISSING_POLICY',
        message: sets.length > 1
          ? remarks.size > 1
            ? '这个客户有多套备注不同的发文方式，文件描述还没对上其中一套。'
            : '这个客户在文件管理下有多种发文方式，文件描述还没对上其中一种发文类型。'
          : '该客户在文件管理下还没有发文方式。'
      })
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
      policyVersion: policy.version,
      policyRemark: policy.remark
    })
  }
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
  groups.sort((left, right) => compare(left.customerIdentity, right.customerIdentity) ||
    compare(left.descriptionIdentity, right.descriptionIdentity) || compare(left.id, right.id))
  for (const group of groups) group.files.sort((left, right) => compare(left.fileId, right.fileId))
  return { groups, skipped }
}
