import { PCL_ORIGIN } from '../api/config'
import type { CustomerSkillId } from './types'

/** 目前只有这一家客户带上案件联系人导出。名字对上就默认解锁，不需要再勾一次。 */
export const CASE_CONTACT_CUSTOMER_NAME = '鹏城实验室'
export const CASE_CONTACT_SKILL: CustomerSkillId = 'case-contacts'
const CUSTOMER_KEY = 'patmail.case-contact.customer'

export function isCustomerSkill(value: unknown): value is CustomerSkillId {
  return value === CASE_CONTACT_SKILL
}

export function normalizeCustomerName(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

export function unlocksCaseContacts(name: string): boolean {
  return normalizeCustomerName(name) === CASE_CONTACT_CUSTOMER_NAME
}

/** 创建鹏城实验室时写入技能。已经解锁过的客户改名后仍然保留。 */
export function caseContactSkills(name: string, previous?: readonly string[]): CustomerSkillId[] | undefined {
  const kept = [...new Set((previous ?? []).filter(isCustomerSkill))]
  if (unlocksCaseContacts(name) && !kept.includes(CASE_CONTACT_SKILL)) kept.push(CASE_CONTACT_SKILL)
  return kept.length ? kept : undefined
}

export function hasCaseContactSkill(profile: { name: string; skills?: readonly string[] }): boolean {
  return unlocksCaseContacts(profile.name) || (profile.skills ?? []).includes(CASE_CONTACT_SKILL)
}

export function rememberCaseContactCustomer(id: string): void {
  sessionStorage.setItem(CUSTOMER_KEY, id)
}

export function rememberedCaseContactCustomer(): string {
  return sessionStorage.getItem(CUSTOMER_KEY) ?? ''
}

/** 转发案件联系人导出之前要同时满足：绑定的是鹏城实验室，而且这个账号已经有这项能力。 */
export function caseContactExportBlock(origin: string, customers: readonly { name: string; skills?: readonly string[] }[]): string {
  if (origin !== PCL_ORIGIN) return '案件联系人只能在鹏城实验室的 EASY 上读取。'
  if (!customers.some(hasCaseContactSkill)) return '先创建客户「鹏城实验室」并保存，才能导出联系人。'
  return ''
}
