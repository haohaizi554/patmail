import { sha256Hex } from './sha256'
import type { CustomerQueryProfile } from '../customer/types'
import type { SelectedPatentFile } from '../mail/types'
import type { QueryTemplate } from '../query/query-types'

/** 任务引用的客户和模板。摘要来自字段内容，不看显示名，也不看更新时间字符串。 */
export interface QueryDependencySnapshot {
  customerProfileId: string
  customerRevision: number
  baseTemplateId: string
  templateId: string
  templateVersion: number
  templateContentDigest: string
  customerOverridesDigest: string
}

/** 稳定序列化。用 JSON 数组保留空字符串，并避免换行、等号和属性顺序造成歧义。 */
export function stableFieldDigest(fields: Record<string, string> | undefined): string {
  const source = fields ?? {}
  const canonical = JSON.stringify(Object.keys(source).sort().map(key => [key, source[key]]))
  return sha256Hex(canonical)
}

export function referencedProfileIds(files: Array<Pick<SelectedPatentFile, 'customerProfileId' | 'customerBinding'>>): string[] {
  const ids = new Set<string>()
  for (const file of files) {
    if (file.customerProfileId) ids.add(file.customerProfileId)
    if (file.customerBinding?.profileId) ids.add(file.customerBinding.profileId)
  }
  return [...ids]
}

export function buildQueryDependencies(profiles: CustomerQueryProfile[], templates: QueryTemplate[], onlyProfileIds?: readonly string[]): QueryDependencySnapshot[] {
  const wanted = onlyProfileIds ? [...new Set(onlyProfileIds)] : profiles.map(profile => profile.id)
  return wanted.map(profileId => {
    const profile = profiles.find(item => item.id === profileId)
    const template = profile
      ? templates.find(item => item.id === profile.baseTemplateId && item.source === 'local') ?? templates.find(item => item.id === profile.baseTemplateId)
      : undefined
    return {
      customerProfileId: profileId,
      customerRevision: profile?.revision ?? 0,
      baseTemplateId: profile?.baseTemplateId ?? '',
      templateId: template?.id ?? '',
      templateVersion: template?.version ?? 0,
      templateContentDigest: profile && template ? stableFieldDigest(template.fields) : 'missing',
      customerOverridesDigest: profile ? stableFieldDigest(profile.overrides) : 'missing'
    }
  }).sort((left, right) => left.customerProfileId < right.customerProfileId ? -1 : left.customerProfileId > right.customerProfileId ? 1 : 0)
}

export function sameQueryDependencies(left: QueryDependencySnapshot[], right: QueryDependencySnapshot[]): boolean {
  const canon = (rows: QueryDependencySnapshot[]) => [...rows].sort((a, b) => a.customerProfileId < b.customerProfileId ? -1 : a.customerProfileId > b.customerProfileId ? 1 : 0)
    .map(row => [row.customerProfileId, row.customerRevision, row.baseTemplateId, row.templateId, row.templateVersion, row.templateContentDigest, row.customerOverridesDigest].join('\u0000'))
    .join('\n')
  return canon(left) === canon(right)
}
