import { isQueryGuid } from '../../query/query-validator'
import type { DescriptionMailTypeMapping, MailGroup } from '../types'

export function mappingKey(item: { fileDescriptionId?: string; fileDescriptionText?: string }): string | null {
  const id = item.fileDescriptionId?.trim()
  if (id) return `id:${id}`
  const text = item.fileDescriptionText?.trim()
  return text ? `text:${text}` : null
}

export function resolveMailType(group: MailGroup, mappings: DescriptionMailTypeMapping[]): { mapping: DescriptionMailTypeMapping | null; conflict: boolean } {
  const enabled = mappings.filter(item => item.enabled && isQueryGuid(item.mailTypeId) && mappingKey(item) === group.descriptionIdentity)
  if (enabled.length > 1) return { mapping: null, conflict: true }
  return { mapping: enabled[0] ?? null, conflict: false }
}

/** 有内部 ID 时只按 ID 匹配。同一键有多条有效映射时不取第一条。 */
export function matchMailType(group: MailGroup, mappings: DescriptionMailTypeMapping[]): DescriptionMailTypeMapping | null {
  return resolveMailType(group, mappings).mapping
}

export function upsertMapping(mappings: DescriptionMailTypeMapping[], next: DescriptionMailTypeMapping): { ok: true; mappings: DescriptionMailTypeMapping[] } | { ok: false; message: string } {
  const key = mappingKey(next)
  if (!key || !isQueryGuid(next.mailTypeId)) return { ok: false, message: '映射缺少描述或发文类型 ID。' }
  const clash = mappings.find(item => item.id !== next.id && item.enabled && next.enabled && mappingKey(item) === key && item.mailTypeId !== next.mailTypeId)
  if (clash) return { ok: false, message: '同一文件描述已经对应另一个发文类型。请修改原映射或取消。' }
  const previous = mappings.find(item => item.id === next.id)
  const saved = { ...next, version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() }
  return { ok: true, mappings: mappings.filter(item => item.id !== next.id).concat(saved) }
}
