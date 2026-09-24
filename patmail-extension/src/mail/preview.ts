import type { CustomerQueryProfile } from '../customer/types'
import { planDrafts } from './planner'
import type { MailDraftPreview, MailRuleBundle, SelectionSnapshot } from './types'

/** PatMail 本地草稿。结果不会写入 EASY，也不表示邮件已经创建。 */
export function buildDraftPreview(snapshot: SelectionSnapshot, rules: MailRuleBundle, profiles: CustomerQueryProfile[], operatorId: string): MailDraftPreview[] {
  return planDrafts(snapshot, rules, profiles, operatorId)
}
