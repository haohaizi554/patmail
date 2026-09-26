import { isConfirmedOperator } from '../automation/operator'
import type { TaskStore } from '../automation/task-service'
import { validateTask } from '../automation/task-validator'
import { CustomerQueryService } from '../customer/service'
import { BundleCustomerRepository } from '../customer/repository'
import type { CustomerQueryProfile } from '../customer/types'
import { MailRuleRepository } from '../mail/repository'
import type { MailRuleBundle } from '../mail/types'
import { ChromeBundleRepository, storageKey } from '../storage/query-bundle'
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

export async function saveCustomerAccount(area: LocalArea, origin: string, operatorId: string, profile: CustomerQueryProfile): Promise<CustomerQueryProfile> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  const service = new CustomerQueryService(new BundleCustomerRepository(new ChromeBundleRepository(storageKey(origin, operatorId), area as chrome.storage.StorageArea)))
  return service.save(profile)
}

export async function refreshStaleTasks(store: TaskStore, origin: string, operatorId: string, rules: MailRuleBundle, profiles: CustomerQueryProfile[]): Promise<number> {
  const tasks = await store.list(origin, operatorId)
  let changed = 0
  for (const task of tasks) {
    const next = validateTask(task, {
      origin, operatorId, files: task.selectedFiles, rules, profiles, queryTemplateVersion: task.queryTemplateVersion
    })
    if (next.status !== task.status || next.readonly !== task.readonly) {
      await store.save(next)
      changed += 1
    }
  }
  return changed
}

export async function saveRuleAccount(area: LocalArea, origin: string, operatorId: string, bundle: MailRuleBundle, tasks: TaskStore | null): Promise<MailRuleBundle> {
  if (!isConfirmedOperator(operatorId)) throw new Error('尚未确认 EASY 用户。')
  const saved = await new MailRuleRepository(operatorId, origin, area).update(draft => {
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
    await refreshStaleTasks(tasks, origin, operatorId, saved, account.customers)
  }
  return saved
}
