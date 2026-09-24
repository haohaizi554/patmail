import type { BodyRule, CustomerMailPolicy, CustomerRecipientTemplate, DescriptionMailTypeMapping, MailRuleBundle, OperatorSignature, SubjectRule } from './types'
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
    body: { template: '请查收{文件数量}个文件。', supplement: '', version: 1 }
  }
}

function isPolicy(value: unknown): value is CustomerMailPolicy {
  if (!value || typeof value !== 'object') return false
  const item = value as CustomerMailPolicy
  return typeof item.customerProfileId === 'string' && (item.sendMode === 'merge_by_customer_description' || item.sendMode === 'single_file') &&
    typeof item.enabled === 'boolean' && typeof item.version === 'number' && typeof item.updatedAt === 'string'
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
  return { bundle: { version: 1, revision: record.revision, ownerId, policies, mappings, recipients, signatures, subject: record.subject, body: record.body }, writable: true }
}

export class MailRuleRepository {
  private memory: MailRuleBundle | null = null
  private tail: Promise<void> = Promise.resolve()
  readonly scope: 'account' | 'session'

  constructor(readonly ownerId: string, private readonly origin: string, private readonly area: { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> } | null) {
    this.scope = mailStorageKey(origin, ownerId) && area ? 'account' : 'session'
  }

  private get key(): string | null {
    return this.scope === 'account' ? mailStorageKey(this.origin, this.ownerId) : null
  }

  async load(): Promise<{ bundle: MailRuleBundle; writable: boolean; warning?: string; scope: 'account' | 'session' }> {
    if (!this.key || !this.area) {
      const bundle = this.memory ?? emptyMailRules(this.ownerId || 'session')
      return { bundle: structuredClone(bundle), writable: true, scope: 'session' }
    }
    const stored = await this.area.get(this.key)
    const read = readMailRules(stored[this.key], this.ownerId)
    return { ...read, scope: 'account' }
  }

  async update(mutate: (bundle: MailRuleBundle) => void): Promise<MailRuleBundle> {
    const run = this.tail.then(async () => {
      const loaded = await this.load()
      if (!loaded.writable) throw new Error(loaded.warning ?? '发文配置只读，未覆盖原数据。')
      const draft = structuredClone(loaded.bundle)
      mutate(draft)
      draft.revision += 1
      draft.ownerId = this.ownerId || 'session'
      const checked = readMailRules(draft, draft.ownerId)
      if (!checked.writable) throw new Error(checked.warning ?? '发文配置未通过校验，未保存。')
      if (this.key && this.area) await this.area.set({ [this.key]: checked.bundle })
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
    })
  }
}
