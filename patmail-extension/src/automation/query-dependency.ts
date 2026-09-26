import { sha256Hex } from './sha256'
import type { CustomerQueryProfile } from '../customer/types'
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

/** 稳定序列化。空字符串保留。键排序后，字段顺序和客户数组顺序不影响摘要。 */
export function stableFieldDigest(fields: Record<string, string> | undefined): string {
  const source = fields ?? {}
  const canonical = Object.keys(source).sort().map(key => `${key}=${source[key]}`).join('\n')
  return sha256Hex(canonical)
}

export function buildQueryDependencies(profiles: CustomerQueryProfile[], templates: QueryTemplate[]): QueryDependencySnapshot[] {
  return profiles.map(profile => {
    const template = templates.find(item => item.id === profile.baseTemplateId && item.source === 'local')
      ?? templates.find(item => item.id === profile.baseTemplateId)
    return {
      customerProfileId: profile.id,
      customerRevision: profile.revision ?? 1,
      baseTemplateId: profile.baseTemplateId,
      templateId: template?.id ?? '',
      templateVersion: template?.version ?? 0,
      templateContentDigest: template ? stableFieldDigest(template.fields) : 'missing',
      customerOverridesDigest: stableFieldDigest(profile.overrides)
    }
  }).sort((left, right) => left.customerProfileId < right.customerProfileId ? -1 : left.customerProfileId > right.customerProfileId ? 1 : 0)
}

export function sameQueryDependencies(left: QueryDependencySnapshot[], right: QueryDependencySnapshot[]): boolean {
  const canon = (rows: QueryDependencySnapshot[]) => [...rows].sort((a, b) => a.customerProfileId < b.customerProfileId ? -1 : a.customerProfileId > b.customerProfileId ? 1 : 0)
    .map(row => [row.customerProfileId, row.customerRevision, row.baseTemplateId, row.templateId, row.templateVersion, row.templateContentDigest, row.customerOverridesDigest].join('\u0000'))
    .join('\n')
  return canon(left) === canon(right)
}
