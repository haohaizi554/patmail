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
