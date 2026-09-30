import { PCL_ORIGIN } from '../api/config'
import type { CustomerSkillId } from './types'

/** 目前只有这一家客户带上案件联系人导出。名字对上就解锁，改成别的名字就关掉。 */
export const CASE_CONTACT_CUSTOMER_NAME = '鹏城国家实验室'
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

/** 只看当前名称。改名后不再沿用以前写下的技能。 */
export function caseContactSkills(name: string): CustomerSkillId[] | undefined {
  return unlocksCaseContacts(name) ? [CASE_CONTACT_SKILL] : undefined
}

export function hasCaseContactSkill(profile: { name: string }): boolean {
  return unlocksCaseContacts(profile.name)
}

export function rememberCaseContactCustomer(id: string): void {
  sessionStorage.setItem(CUSTOMER_KEY, id)
}

export function rememberedCaseContactCustomer(): string {
  return sessionStorage.getItem(CUSTOMER_KEY) ?? ''
}

/** 转发案件联系人导出之前要同时满足：当前名称是这家客户，而且账号开在对应的 EASY 上。 */
export function caseContactExportBlock(origin: string, customers: readonly { name: string }[]): string {
  if (origin !== PCL_ORIGIN) return `案件联系人只能在${CASE_CONTACT_CUSTOMER_NAME}的 EASY 上读取。`
  if (!customers.some(hasCaseContactSkill)) return `先创建客户「${CASE_CONTACT_CUSTOMER_NAME}」并保存，才能导出联系人。`
  return ''
}
