import { isConfirmedOperator } from '../automation/operator'
import type { TaskStore } from '../automation/task-service'
import { validateTask } from '../automation/task-validator'
import { CustomerQueryService } from '../customer/service'
import { BundleCustomerRepository } from '../customer/repository'
import type { CustomerQueryProfile } from '../customer/types'
import { MailRuleRepository, mailStorageKey } from '../mail/repository'
import type { MailRuleBundle } from '../mail/types'
import { ChromeBundleRepository, storageKey } from '../storage/query-bundle'
import { BundleTemplateRepository } from '../query/repository'
import type { QueryTemplate } from '../query/query-types'

export interface LocalArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export interface AccountSnapshot {
  customers: CustomerQueryProfile[]
  templates: QueryTemplate[]
  rules: MailRuleBundle | null
}

export async function loadAccount(area: LocalArea, origin: string, operatorId: string): Promise<AccountSnapshot> {
  if (!isConfirmedOperator(operatorId)) return { customers: [], templates: [], rules: null }
  const bundles = new ChromeBundleRepository(storageKey(origin, operatorId), area as chrome.storage.StorageArea)
  const loaded = await bundles.load()
  const rules = await new MailRuleRepository(operatorId, origin, area).load()
  return { customers: loaded.bundle.customers, templates: loaded.bundle.templates, rules: rules.bundle }
}

export async function saveCustomerAccount(area: LocalArea, origin: string, operatorId: string, profile: CustomerQueryProfile, expectedRevision?: number): Promise<CustomerQueryProfile> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  return enqueueBundle(origin, operatorId, async () => {
    const repository = new BundleCustomerRepository(new ChromeBundleRepository(storageKey(origin, operatorId), area as chrome.storage.StorageArea))
    const existing = profile.id ? await repository.get(profile.id) : null
    const current = existing?.revision ?? 1
    if (existing && expectedRevision === undefined) throw new Error('已有客户必须提供预期版本。')
    if (existing && expectedRevision !== current) throw new Error('客户配置已被其他页面更新，请重新读取后再保存。')
    const service = new CustomerQueryService(repository)
    return service.save({ ...profile, revision: existing ? current + 1 : 1 })
  })
}

export async function deleteCustomerAccount(area: LocalArea, origin: string, operatorId: string, id: string, expectedRevision?: number): Promise<void> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  return enqueueBundle(origin, operatorId, async () => {
    const repository = new BundleCustomerRepository(new ChromeBundleRepository(storageKey(origin, operatorId), area as chrome.storage.StorageArea))
    const existing = await repository.get(id)
    if (!existing) return
    if (expectedRevision === undefined) throw new Error('已有客户必须提供预期版本。')
    if (expectedRevision !== (existing.revision ?? 1)) throw new Error('客户配置已被其他页面更新，请重新读取后再保存。')
    await repository.delete(id)
  })
}

export async function saveQueryTemplateAccount(area: LocalArea, origin: string, operatorId: string, template: QueryTemplate, expectedVersion: number | null): Promise<void> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  return enqueueBundle(origin, operatorId, async () => {
    if (template.source !== 'local') throw new Error('不能写入原网站历史模板。')
    const repository = new BundleTemplateRepository(new ChromeBundleRepository(storageKey(origin, operatorId), area as chrome.storage.StorageArea))
    const existing = await repository.get(template.id)
    const now = new Date().toISOString()
    if (existing) {
      if (existing.source !== 'local') throw new Error('不能覆盖原网站历史模板。')
      if (expectedVersion == null) throw new Error('已有模板必须提供预期版本。')
      if (existing.version !== expectedVersion) throw new Error('查询模板已被其他页面更新，请重新读取后再保存。')
      await repository.save({ ...template, source: 'local', version: existing.version + 1, createdAt: existing.createdAt, updatedAt: now })
      return
    }
    await repository.save({ ...template, source: 'local', version: 1, createdAt: template.createdAt || now, updatedAt: now })
  })
}

export async function deleteQueryTemplateAccount(area: LocalArea, origin: string, operatorId: string, id: string): Promise<void> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  return enqueueBundle(origin, operatorId, async () => {
    const repository = new BundleTemplateRepository(new ChromeBundleRepository(storageKey(origin, operatorId), area as chrome.storage.StorageArea))
    const existing = await repository.get(id)
    if (existing && existing.source !== 'local') throw new Error('不能删除原网站历史模板。')
    await repository.delete(id)
  })
}

const bundleQueues = new Map<string, Promise<unknown>>()

/** 同一 Background 实例内把同一账号的配置包修改排成一队。这不是跨进程事务。 */
function enqueueBundle<T>(origin: string, operatorId: string, work: () => Promise<T>): Promise<T> {
  const key = storageKey(origin, operatorId)
  const previous = bundleQueues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  bundleQueues.set(key, run.then(() => undefined, () => undefined))
  return run
}

export async function refreshStaleTasks(store: TaskStore, origin: string, operatorId: string, rules: MailRuleBundle, profiles: CustomerQueryProfile[], templates: QueryTemplate[] = []): Promise<number> {
  const tasks = await store.list(origin, operatorId)
  let changed = 0
  for (const task of tasks) {
    const next = validateTask(task, {
      origin, operatorId, files: task.selectedFiles, rules, profiles, templates, queryTemplateVersion: task.queryTemplateVersion
    })
    if (next.status !== task.status || next.readonly !== task.readonly) {
      await store.save(next)
      changed += 1
    }
  }
  return changed
}

const ruleQueues = new Map<string, Promise<unknown>>()

function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = ruleQueues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  ruleQueues.set(key, run.then(() => undefined, () => undefined))
  return run
}

export async function saveRuleAccount(area: LocalArea, origin: string, operatorId: string, bundle: MailRuleBundle, tasks: TaskStore | null): Promise<MailRuleBundle> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  const key = mailStorageKey(origin, operatorId) ?? `${origin}:${operatorId}`
  return enqueue(key, async () => {
  const repo = new MailRuleRepository(operatorId, origin, area)
  const current = await repo.load()
  if (bundle.revision !== current.bundle.revision) throw new Error('发文规则已被其他页面更新，请重新读取后再保存。')
  const saved = await repo.update(draft => {
    draft.ownerId = operatorId
    draft.policies = bundle.policies
    draft.mappings = bundle.mappings
    draft.recipients = bundle.recipients
    draft.signatures = bundle.signatures
    draft.subject = bundle.subject
    draft.body = bundle.body
  })
  if (tasks) {
    const account = await loadAccount(area, origin, operatorId)
    await refreshStaleTasks(tasks, origin, operatorId, saved, account.customers, account.templates)
  }
  return saved
  })
}
