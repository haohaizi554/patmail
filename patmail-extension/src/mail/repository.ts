import { plainClone } from '../automation/snapshot'
import type { BodyRule, CustomerMailPolicy, CustomerRecipientTemplate, DefaultReviewer, DefaultSender, DescriptionMailTypeMapping, MailRuleBundle, OperatorSignature, SubjectRule } from './types'
import { isQueryGuid } from '../query/query-validator'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function mailStorageKey(origin: string, userId: string): string | null {
  if (!GUID.test(userId)) return null
  return `patmail.mail.v1:${origin}:${userId}`
}

export function emptyMailRules(ownerId: string): MailRuleBundle {
  return {
    version: 1, revision: 1, ownerId,
    policies: [], mappings: [], recipients: [], signatures: [],
    subject: { template: '关于{文件名称}的通知', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 },
    body: { template: '请查收{文件数量}个文件。', supplement: '', version: 1 },
    defaultReviewer: null,
    defaultSender: null,
    defaultSignatureId: null
  }
}

function isPolicy(value: unknown): value is CustomerMailPolicy {
  if (!value || typeof value !== 'object') return false
  const item = value as CustomerMailPolicy
  if (typeof item.customerProfileId !== 'string' || typeof item.enabled !== 'boolean' || typeof item.version !== 'number' || typeof item.updatedAt !== 'string') return false
  const surface = item.querySurface === undefined || item.querySurface === 'file' ? 'file' : item.querySurface === 'limit' ? 'limit' : ''
  if (!surface) return false
  if (surface === 'limit') {
    if (item.limitMailStyle !== '1' && item.limitMailStyle !== '2' && item.limitMailStyle !== '3') return false
  } else if (item.sendMode !== 'merge_by_customer_description' && item.sendMode !== 'single_file') return false
  if (item.remark != null && item.remark !== '' && (typeof item.remark !== 'string' || item.remark.length > 80 || !item.remark.trim())) return false
  if (item.mailTypeId === undefined && item.mailTypeName === undefined) return true
  return typeof item.mailTypeId === 'string' && isQueryGuid(item.mailTypeId) && typeof item.mailTypeName === 'string' && item.mailTypeName.trim().length > 0
}
function isMapping(value: unknown): value is DescriptionMailTypeMapping {
  if (!value || typeof value !== 'object') return false
  const item = value as DescriptionMailTypeMapping
  return typeof item.id === 'string' && isQueryGuid(item.mailTypeId) && typeof item.mailTypeName === 'string' &&
    typeof item.enabled === 'boolean' && typeof item.version === 'number'
}
function isRecipient(value: unknown): value is CustomerRecipientTemplate {
  if (!value || typeof value !== 'object') return false
  const item = value as CustomerRecipientTemplate
  return typeof item.id === 'string' && typeof item.customerProfileId === 'string' && typeof item.name === 'string' &&
    Array.isArray(item.to) && Array.isArray(item.cc) &&
    item.to.every(address => typeof address === 'string') && item.cc.every(address => typeof address === 'string') &&
    typeof item.enabled === 'boolean' && typeof item.isDefault === 'boolean' && typeof item.version === 'number' && typeof item.updatedAt === 'string'
}
function isSignature(value: unknown, ownerId: string): value is OperatorSignature {
  if (!value || typeof value !== 'object') return false
  const item = value as OperatorSignature
  return item.operatorId === ownerId && ownerId.length > 0 && typeof item.content === 'string' &&
    typeof item.enabled === 'boolean' && typeof item.isDefault === 'boolean' && typeof item.name === 'string'
}
function isSubject(value: unknown): value is SubjectRule {
  if (!value || typeof value !== 'object') return false
  const item = value as SubjectRule
  return typeof item.template === 'string' && typeof item.countInjection === 'boolean' && typeof item.anchor === 'string' &&
    (item.missingAnchor === 'keep' || item.missingAnchor === 'prefix' || item.missingAnchor === 'confirm')
}
function isBody(value: unknown): value is BodyRule {
  if (!value || typeof value !== 'object') return false
  const item = value as BodyRule
  return typeof item.template === 'string' && typeof item.supplement === 'string'
}

export function readMailRules(value: unknown, ownerId: string): { bundle: MailRuleBundle; writable: boolean; warning?: string } {
  if (value === undefined || value === null) return { bundle: emptyMailRules(ownerId), writable: true }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '发文配置无法识别，未覆盖原数据。' }
  }
  const record = value as Record<string, unknown>
  if (JSON.stringify(record).toLowerCase().includes('cookie') || Object.keys(record).some(key => /password|authorization/i.test(key))) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '发文配置包含不允许保存的字段。' }
  }
  if (record.version !== 1 || record.ownerId !== ownerId || typeof record.revision !== 'number') {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '发文配置版本或归属不匹配，未覆盖原数据。' }
  }
  if (!Array.isArray(record.policies) || !Array.isArray(record.mappings) || !Array.isArray(record.recipients) || !Array.isArray(record.signatures)) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '发文配置有无法识别的条目，未覆盖原数据。' }
  }
  const policies = record.policies.filter(isPolicy)
  const mappings = Array.isArray(record.mappings) ? record.mappings.filter(isMapping) : []
  const recipients = Array.isArray(record.recipients) ? record.recipients.filter(isRecipient) : []
  const signatures = Array.isArray(record.signatures) ? record.signatures.filter(item => isSignature(item, ownerId)) : []
  if (!isSubject(record.subject) || !isBody(record.body) ||
      policies.length !== record.policies.length ||
      mappings.length !== record.mappings.length ||
      recipients.length !== record.recipients.length ||
      signatures.length !== record.signatures.length) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '发文配置有无法识别的条目，未覆盖原数据。' }
  }
  const reviewer = readDefaultReviewer(record.defaultReviewer)
  if (record.defaultReviewer !== undefined && record.defaultReviewer !== null && !reviewer) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '默认审核人无法识别，未覆盖原数据。' }
  }
  const sender = readDefaultSender(record.defaultSender)
  if (record.defaultSender !== undefined && record.defaultSender !== null && !sender) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '默认发件人无法识别，未覆盖原数据。' }
  }
  const signaturePref = readDefaultSignatureId(record.defaultSignatureId)
  if (signaturePref === undefined) {
    return { bundle: emptyMailRules(ownerId), writable: false, warning: '默认签名无法识别，未覆盖原数据。' }
  }
  return { bundle: { version: 1, revision: record.revision, ownerId, policies, mappings, recipients, signatures, subject: record.subject, body: record.body, defaultReviewer: reviewer, defaultSender: sender, defaultSignatureId: signaturePref }, writable: true }
}

function readDefaultReviewer(value: unknown): DefaultReviewer | null {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as DefaultReviewer
  if (!isQueryGuid(row.userId) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80) return null
  return { userId: row.userId, name: row.name.trim() }
}

const SIGNATURE_PREF = /^(site|diy):\S{1,120}$/

/** 缺省是 null，表示沿用原站签名。写了但认不出则整份规则不覆盖。 */
function readDefaultSignatureId(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' && SIGNATURE_PREF.test(value)) return value
  return undefined
}

function readDefaultSender(value: unknown): DefaultSender | null {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as DefaultSender
  if (!isQueryGuid(row.mailsetId) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 160) return null
  return { mailsetId: row.mailsetId, label: row.label.trim() }
}

type StorageAreaLike = { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> }

export class MailRuleRepository {
  private memory: MailRuleBundle | null = null
  private tail: Promise<void> = Promise.resolve()
  private readonly readKey: ((key: string) => Promise<Record<string, unknown>>) | null
  private readonly writeKey: ((items: Record<string, unknown>) => Promise<void>) | null
  readonly scope: 'account' | 'session'

  constructor(readonly ownerId: string, private readonly origin: string, area: StorageAreaLike | null) {
    this.scope = mailStorageKey(origin, ownerId) && area ? 'account' : 'session'
    this.readKey = area ? key => area.get.call(area, key) : null
    this.writeKey = area ? items => area.set.call(area, items) : null
  }

  private get key(): string | null {
    return this.scope === 'account' ? mailStorageKey(this.origin, this.ownerId) : null
  }

  async load(): Promise<{ bundle: MailRuleBundle; writable: boolean; warning?: string; scope: 'account' | 'session' }> {
    if (!this.key || !this.readKey) {
      const bundle = this.memory ?? emptyMailRules(this.ownerId || 'session')
      return { bundle: plainClone(bundle), writable: true, scope: 'session' }
    }
    const stored = await this.readKey(this.key)
    const read = readMailRules(stored[this.key], this.ownerId)
    return { ...read, scope: 'account' }
  }

  async update(mutate: (bundle: MailRuleBundle) => void): Promise<MailRuleBundle> {
    const run = this.tail.then(async () => {
      const loaded = await this.load()
      if (!loaded.writable) throw new Error(loaded.warning ?? '发文配置只读，未覆盖原数据。')
      const draft = plainClone(loaded.bundle)
      mutate(draft)
      draft.revision += 1
      draft.ownerId = this.ownerId || 'session'
      const checked = readMailRules(draft, draft.ownerId)
      if (!checked.writable) throw new Error(checked.warning ?? '发文配置未通过校验，未保存。')
      if (this.key && this.writeKey) await this.writeKey({ [this.key]: checked.bundle })
      else this.memory = checked.bundle
      return checked.bundle
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  exportJson(bundle: MailRuleBundle): string {
    return JSON.stringify(bundle)
  }

  async importJson(raw: string): Promise<MailRuleBundle> {
    const parsed = JSON.parse(raw) as unknown
    const read = readMailRules(parsed, this.ownerId || 'session')
    if (!read.writable) throw new Error(read.warning ?? '不能导入这份发文配置。')
    return this.update(bundle => {
      bundle.policies = read.bundle.policies
      bundle.mappings = read.bundle.mappings
      bundle.recipients = read.bundle.recipients
      bundle.signatures = read.bundle.signatures
      bundle.subject = read.bundle.subject
      bundle.body = read.bundle.body
      bundle.defaultReviewer = read.bundle.defaultReviewer
      bundle.defaultSender = read.bundle.defaultSender
      bundle.defaultSignatureId = read.bundle.defaultSignatureId ?? null
    })
  }
}
