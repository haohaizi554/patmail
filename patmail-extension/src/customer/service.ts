import { isQueryGuid } from '../query/query-validator'
import type { CustomerRepository } from './repository'
import type { CustomerQueryProfile } from './types'

export class CustomerQueryService {
  constructor(private readonly repository: CustomerRepository, private readonly now: () => string = () => new Date().toISOString()) {}

  list(): Promise<CustomerQueryProfile[]> {
    return this.repository.list()
  }

  async save(input: Omit<CustomerQueryProfile, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }): Promise<CustomerQueryProfile> {
    const name = input.name.trim()
    if (!name) throw new Error('请填写客户名称。')
    if (input.easyCustomerId && !isQueryGuid(input.easyCustomerId)) throw new Error('原网站客户 ID 必须是已确认的 GUID。')
    if (!input.baseTemplateId.trim()) throw new Error('请选择基础模板。')
    const existing = input.id ? await this.repository.get(input.id) : null
    const profile: CustomerQueryProfile = {
      id: existing?.id ?? input.id ?? `customer-${crypto.randomUUID()}`,
      name,
      ...(input.easyCustomerId ? { easyCustomerId: input.easyCustomerId } : {}),
      baseTemplateId: input.baseTemplateId.trim(),
      overrides: { ...input.overrides },
      ...(input.querySurface ? { querySurface: input.querySurface } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.limitMailStyle ? { limitMailStyle: input.limitMailStyle } : {}),
      ...(input.fileMailStyle ? { fileMailStyle: input.fileMailStyle } : {}),
      ...(input.boundQuery ? { boundQuery: { ...input.boundQuery } } : {}),
      ...(input.reviewTarget ? { reviewTarget: input.reviewTarget } : {}),
      ...(input.mailsetId && input.mailsetLabel ? { mailsetId: input.mailsetId, mailsetLabel: input.mailsetLabel } : {}),
      ...(input.pctTask ? { pctTask: { ...input.pctTask, rows: input.pctTask.rows.map(row => ({ ...row })), confirmedProcIds: [...input.pctTask.confirmedProcIds] } } : {}),
      enabled: input.enabled,
      revision: input.revision ?? existing?.revision ?? 1,
      createdAt: existing?.createdAt ?? this.now(),
      updatedAt: this.now()
    }
    await this.repository.save(profile)
    return profile
  }

  delete(id: string): Promise<void> {
    return this.repository.delete(id)
  }
}
