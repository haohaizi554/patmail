import { isRecord, readClientInfo } from '../../api/response-guards'
import { isQueryGuid } from '../../query/query-validator'

export interface NamedMailbox {
  id: string
  name: string
  email: string
}

export interface NamedContact {
  name: string
  email: string
}

export interface WordRule {
  procId: string
  level: string
  reviewStage: string
  mailTypeName: string
  mailTypeId: string
}

export interface MailNameRule {
  code: string
  text: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function loggedIn(data: Record<string, unknown>): boolean {
  const client = readClientInfo(data.ClientInfo)
  return client.ok && client.data.IsLogin !== false
}

/** Getforeignpic 的 mailsettinglist。页面用来在发件人下拉前插入对外处理人。 */
export function readForeignPic(data: unknown): NamedMailbox[] {
  if (!isRecord(data) || !loggedIn(data) || !Array.isArray(data.mailsettinglist)) return []
  const items: NamedMailbox[] = []
  for (const row of data.mailsettinglist) {
    if (!isRecord(row) || !isQueryGuid(text(row.mailset_id))) continue
    const email = text(row.SMTPFromEmail)
    const name = text(row.cn_name)
    if (!email || !name) continue
    items.push({ id: text(row.mailset_id), name, email })
  }
  return items
}

/** GetCustomerflow 的 CustomerFlow。null 或空数组都是没有联系人。 */
export function readCustomerFlow(data: unknown): NamedContact[] | null {
  if (!isRecord(data) || !loggedIn(data)) return null
  if (data.CustomerFlow === null) return []
  if (!Array.isArray(data.CustomerFlow)) return null
  return data.CustomerFlow.flatMap(row => {
    if (!isRecord(row)) return []
    const name = text(row.cn_name)
    const email = text(row.email)
    if (!name || !email) return []
    return [{ name, email }]
  })
}

/** GetSJHCMailRule 的 SJHCMailRule。页面按处理事项、文字级别和审查阶段自动选发文类型。 */
export function readWordRules(data: unknown): WordRule[] {
  if (!isRecord(data) || !Array.isArray(data.SJHCMailRule)) return []
  const items: WordRule[] = []
  for (const row of data.SJHCMailRule) {
    if (!isRecord(row) || !isQueryGuid(text(row.customer_wordrule_name_id))) continue
    const mailTypeName = text(row.mail_type_zh_cn)
    if (!mailTypeName) continue
    items.push({
      procId: text(row.customer_wordrule_proc_id),
      level: text(row.customer_level),
      reviewStage: text(row.customer_wordrule_review_stage),
      mailTypeName,
      mailTypeId: text(row.customer_wordrule_name_id)
    })
  }
  return items
}

/** LoadCustomerMailType 的 RuleList。FV07 用 fixed_text，FV15 用 file_desc，其余用 role_type。 */
export function readMailNameRules(data: unknown): MailNameRule[] {
  if (!isRecord(data) || !Array.isArray(data.RuleList)) return []
  const items: MailNameRule[] = []
  for (const row of data.RuleList) {
    if (!isRecord(row)) continue
    const code = text(row.code)
    if (!code) continue
    const value = code === 'FV07' ? text(row.fixed_text) : code === 'FV15' ? text(row.file_desc) : text(row.role_type)
    if (!value) continue
    items.push({ code, text: value })
  }
  return items
}
