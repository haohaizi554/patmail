import { isQueryGuid } from '../../query/query-validator'
import type { DescriptionMailTypeMapping, MailGroup } from '../types'

/** 有内部 ID 时只按 ID 匹配。没有 ID 时才按用户维护的描述文本精确匹配。 */
export function matchMailType(group: MailGroup, mappings: DescriptionMailTypeMapping[]): DescriptionMailTypeMapping | null {
  const enabled = mappings.filter(item => item.enabled && isQueryGuid(item.mailTypeId))
  const descriptionId = group.files.find(file => file.fileDescriptionId)?.fileDescriptionId?.trim()
  if (descriptionId) return enabled.find(item => item.fileDescriptionId === descriptionId) ?? null
  const text = group.descriptionLabel.trim()
  if (!text) return null
  return enabled.find(item => item.fileDescriptionText?.trim() === text) ?? null
}
