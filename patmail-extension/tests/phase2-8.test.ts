import { describe, expect, it } from 'vitest'
import { EasyTransport } from '../src/api/transport'
import { CheckpointService } from '../src/automation/checkpoint-service'
import { analyzeExchange, evidenceLevel, productionWriteAllowed, redactRecord } from '../src/automation/contract-capture'
import { classifyReadonlyCall, LIVE_EASY_ACCEPTANCE } from '../src/automation/easy-acceptance'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { MemoryTaskRepository, migrateTask } from '../src/automation/repository'
import { sha256Hex } from '../src/automation/sha256'
import { buildStagePlans } from '../src/automation/stage-plan'
import { buildTask, taskFingerprint, type TaskBuildInput } from '../src/automation/task-builder'
import { AutomationTaskService } from '../src/automation/task-service'
import { validateTask } from '../src/automation/task-validator'
import { runDryRun } from '../src/automation/dry-run'
import { emptyMailRules } from '../src/mail'
import type { CustomerQueryProfile } from '../src/customer/types'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { mailWritesEnabled } from '../src/mail/easy/gate'
import { workflowWritesEnabled } from '../src/workflow/gate'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const user = guid('aaaaaaaa')
const mailType = guid('cccccccc')
const fileA = guid('11111111')
const fileB = guid('22222222')

function file(id: string, customer: string, description: string, name = `文件${id.slice(0, 8)}`): SelectedPatentFile {
  return {
    fileId: id, fileName: name, fileDescription: description, customerName: customer === 'profile-a' ? '客户A' : '客户B',
    customerProfileId: customer,
    customerBinding: { profileId: customer, profileName: customer === 'profile-a' ? '客户A' : '客户B', sourceCustomerName: customer === 'profile-a' ? '客户A' : '客户B', confirmed: true, source: 'explicit' }
  }
}
function profile(id: string, name: string): CustomerQueryProfile {
  return { id, name, baseTemplateId: 'base', overrides: {}, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(partial: Partial<MailRuleBundle> = {}): MailRuleBundle {
  return {
    ...emptyMailRules(user), revision: 2,
    policies: [
      { customerProfileId: 'profile-a', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' },
      { customerProfileId: 'profile-b', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }
    ],
    mappings: [{ id: 'map-1', fileDescriptionText: '专利证书', mailTypeId: mailType, mailTypeName: '证书通知', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    recipients: [
      { id: 'to-a', customerProfileId: 'profile-a', name: '默认', to: ['a@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' },
      { id: 'to-b', customerProfileId: 'profile-b', name: '默认', to: ['b@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }
    ],
    signatures: [{ id: 'sign', operatorId: user, name: '默认签名', content: '此致', enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    subject: { template: '关于{文件名称}的通知', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 },
    body: { template: '请查收{文件数量}个文件。', supplement: '', version: 1 },
    ...partial
  }
}
function input(files: SelectedPatentFile[], bundle = rules(), version = 1): TaskBuildInput {
  return { origin, operatorId: user, files, rules: bundle, profiles: [profile('profile-a', '客户A'), profile('profile-b', '客户B')], queryTemplateVersion: version, now: '2026-09-26T00:00:00.000Z' }
}

describe('任务身份', () => {
  it('uses a uuid task id and a stable content hash', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const files = [file(fileA, 'profile-a', '专利证书'), file(fileB, 'profile-a', '专利证书')]
    const first = buildTask(input(files))
    const second = buildTask(input([files[1]!, files[0]!]))
    expect(first.taskId).not.toBe(second.taskId)
    expect(first.taskId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(first.taskFingerprint).toBe(second.taskFingerprint)
    expect(first.taskFingerprint).toBe(taskFingerprint(input(files)))
    expect(first.taskFingerprint).not.toContain(origin)
    const renamed = buildTask(input([file(fileA, 'profile-a', '专利证书', '另一份')]))
    expect(renamed.taskFingerprint).not.toBe(first.taskFingerprint)
    const signed = buildTask(input(files, rules({ signatures: [{ id: 'sign', operatorId: user, name: '默认签名', content: '敬礼', enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }] })))
    expect(signed.taskFingerprint).not.toBe(first.taskFingerprint)
    const copied = buildTask(input(files, rules({ recipients: [{ id: 'to-a', customerProfileId: 'profile-a', name: '默认', to: ['c@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }] })))
    expect(copied.taskFingerprint).not.toBe(first.taskFingerprint)
    const body = buildTask(input(files, rules({ body: { template: '另附说明。', supplement: '', version: 1 } })))
    expect(body.taskFingerprint).not.toBe(first.taskFingerprint)
    const described = buildTask(input([file(fileA, 'profile-a', '审查意见')]))
    expect(described.taskFingerprint).not.toBe(buildTask(input([file(fileA, 'profile-a', '专利证书')])).taskFingerprint)
    expect(buildTask(input(files, rules(), 9)).taskFingerprint).not.toBe(first.taskFingerprint)
  })

  it('keeps a legacy id as a migration record and does not clear an unknown mail', () => {
    const current = buildTask(input([file(fileA, 'profile-a', '专利证书')]))
    const legacy = {
      ...current,
      taskId: 'task-http://183.36.43.66',
      status: 'UNKNOWN' as const,
      items: current.items.map(item => ({ ...item, easyMailId: '083aa041-1111-4111-8111-111111111111', status: 'UNKNOWN' as const }))
    }
    const migrated = migrateTask(legacy)
    expect(migrated.migration?.from).toBe(legacy.taskId)
    expect(migrated.task.taskId).not.toBe(legacy.taskId)
    expect(migrated.task.legacyTaskId).toBe(legacy.taskId)
    expect(migrated.task.items[0]?.easyMailId).toBe('083aa041-1111-4111-8111-111111111111')
    expect(migrated.task.status).toBe('UNKNOWN')
    expect(migrated.task.readonly).toBe(true)
    const again = migrateTask(migrated.task)
    expect(again.task.taskId).toBe(migrated.task.taskId)
    expect(again.migration).toBeNull()
  })
})

describe('任务存储', () => {
  it('saves, reloads, migrates and refuses to archive an unknown task', async () => {
    const store = new MemoryTaskRepository()
    const service = new AutomationTaskService(store)
    const created = await service.createTask(input([file(fileA, 'profile-a', '专利证书'), file(fileB, 'profile-b', '专利证书')]))
    expect(created.persisted).toBe(true)
    if (!created.ok) return
    expect(created.task.customerProfileId).toBe('')
    expect(created.task.customerName).toBe('多个客户')
    expect(created.task.customers.map(item => item.id).sort()).toEqual(['profile-a', 'profile-b'])
    expect(created.task.items.map(item => item.customerProfileId).sort()).toEqual(['profile-a', 'profile-b'])
    const listed = await service.listTasks(origin, user)
    expect(listed.map(item => item.taskId)).toEqual([created.task.taskId])
    const broken = new MemoryTaskRepository()
    broken.save = async () => { throw new Error('disk') }
    const failed = await new AutomationTaskService(broken).createTask(input([file(fileA, 'profile-a', '专利证书')]))
    expect(failed.persisted).toBe(false)
    expect(failed.ok).toBe(false)
    const unknown = { ...created.task, status: 'UNKNOWN' as const }
    await store.save(unknown)
    expect((await service.archiveTask(origin, user, unknown.taskId)).ok).toBe(false)
    expect((await service.listTasks(origin, user)).some(item => item.taskId === unknown.taskId)).toBe(true)
    const done = buildTask(input([file(fileA, 'profile-a', '专利证书')]))
    await store.save(done)
    expect((await service.archiveTask(origin, user, done.taskId)).ok).toBe(true)
    expect((await service.listTasks(origin, user)).some(item => item.taskId === done.taskId)).toBe(false)
    const changed = validateTask(created.task, input([file(fileA, 'profile-a', '专利证书', '改名')]))
    expect(changed.status).toBe('STALE')
    const kept = service.recoverTask(unknown)
    expect(kept.task.status).toBe('UNKNOWN')
  })
})

describe('执行记录事务', () => {
  it('lets one fingerprint have one owner and stops when the checkpoint cannot be stored', async () => {
    const store = memoryTransactionStore()
    const left = new ExecutionLedger(store, 'tab-a')
    const right = new ExecutionLedger(store, 'tab-b')
    const [first, second, other] = await Promise.all([
      left.claim(origin, user, 'finger-1'),
      right.claim(origin, user, 'finger-1'),
      right.claim(origin, user, 'finger-2')
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(other.ok).toBe(true)
    if (!first.ok) return
    const sent = await left.markSent(first.lease.executionId, first.lease.leaseVersion, 'MAIL_CREATE')
    expect(sent.ok).toBe(true)
    const restarted = new ExecutionLedger(store, 'worker-2')
    const recovered = await restarted.recover(origin, user)
    expect(recovered.find(item => item.executionId === first.lease.executionId)?.status).toBe('UNKNOWN')
    expect((await restarted.claim(origin, user, 'finger-1')).ok).toBe(false)
    const task = buildTask(input([file(fileA, 'profile-a', '专利证书')]))
    const checkpoints = new CheckpointService({ save: async () => { throw new Error('full') } })
    const refused = await checkpoints.markRequestSent(task, task.items[0]?.itemId ?? '', 'MAIL_CREATE')
    expect(refused.ok).toBe(false)
    expect(refused.task.checkpoints).toHaveLength(0)
    expect(refused.reason).toContain('不会发出')
  })
})

describe('Dry-run 与契约', () => {
  it('plans stages without calling fetch and does not promote mock or 502 evidence', () => {
    const calls: string[] = []
    const transport = new EasyTransport(origin, { fetcher: async (_url, init) => {
      calls.push(new URLSearchParams(String(init?.body)).get('Call') ?? 'fetch')
      throw new Error('dry-run 不应访问网络')
    } })
    const result = runDryRun(input([file(fileA, 'profile-a', '专利证书'), file(fileB, 'profile-a', '专利证书')]), transport)
    expect(calls).toEqual([])
    expect(result.writeCalls).toEqual([])
    expect(result.plans.some(item => item.stage === 'MAIL_CREATE' && item.canExecute)).toBe(false)
    expect(result.plans.some(item => item.stage === 'DRAFT_VALIDATE' && item.canExecute)).toBe(true)
    const missing = runDryRun(input([file(fileA, 'profile-a', '专利证书')], rules({ recipients: [] })))
    expect(buildStagePlans(missing.task).find(item => item.stage === 'RECIPIENT_RESOLVE')?.canExecute).toBe(false)
    const sample = analyzeExchange({
      handler: '/AjaxServers/Notice.ashx', call: 'MailCustomer', statusCode: 200, source: 'live',
      request: { Call: 'MailCustomer', Cookie: 'secret', mail_body: '正文', mail_to: 'a@example.com' },
      response: { objid: '1', note: '联系 a@example.com' }, readbackMatched: true
    })
    expect(JSON.stringify(redactRecord(sample))).not.toContain('secret')
    expect(JSON.stringify(sample)).not.toContain('a@example.com')
    expect(evidenceLevel([sample], 'MailCustomer')).toBe('READBACK_VERIFIED')
    const gateway = analyzeExchange({
      handler: '/AjaxServers/Common.ashx', call: 'GetFlowSubmit', statusCode: 502, source: 'live',
      request: { Call: 'GetFlowSubmit' }, response: ''
    })
    expect(gateway.businessSuccess).toBe(false)
    expect(evidenceLevel([gateway], 'GetFlowSubmit')).toBe('REQUEST_OBSERVED')
    const mocked = analyzeExchange({
      handler: '/AjaxServers/Notice.ashx', call: 'MailCustomer', statusCode: 200, source: 'mock',
      request: { Call: 'MailCustomer' }, response: { objid: '1' }, readbackMatched: true
    })
    expect(evidenceLevel([mocked], 'MailCustomer')).toBe('UNKNOWN')
    expect(productionWriteAllowed()).toBe(true)
    expect(mailWritesEnabled()).toBe(true)
    expect(workflowWritesEnabled()).toBe(true)
    expect(LIVE_EASY_ACCEPTANCE.status).toBe('PENDING')
    expect(classifyReadonlyCall('GetFlowSubmit', 502).ok).toBe(false)
    expect(classifyReadonlyCall('MailCustomer', 200).ok).toBe(false)
  })
})
