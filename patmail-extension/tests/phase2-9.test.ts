import { describe, expect, it } from 'vitest'
import { LiveEasyAcceptanceRunner, READONLY_ACCEPTANCE_CALLS, type LiveAcceptanceRecord } from '../src/automation/acceptance-runner'
import { handleAuthorityMessage } from '../src/background/authority'
import { CheckpointService } from '../src/automation/checkpoint-service'
import { MemoryEvidenceStore, evidenceLevelOf, sealEvidence } from '../src/automation/evidence-store'
import { importHar } from '../src/automation/har-import'
import { SerialTaskStore } from '../src/automation/indexed-store'
import { ExecutionLedger, memoryTransactionStore } from '../src/automation/ledger'
import { MemoryTaskRepository } from '../src/automation/repository'
import { buildTask, taskFingerprint, type TaskBuildInput } from '../src/automation/task-builder'
import { AutomationTaskService } from '../src/automation/task-service'
import { validateTask } from '../src/automation/task-validator'
import { executionMode, runControlledWrite, type TestExecutionScope } from '../src/automation/test-write'
import { ContractVerifierRegistry } from '../src/automation/verifiers'
import { emptyMailRules } from '../src/mail'
import type { CustomerQueryProfile } from '../src/customer/types'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { mailWritesEnabled } from '../src/mail/easy/gate'
import { MessageType, isMessage } from '../src/shared/message'
import { workflowWritesEnabled } from '../src/workflow/gate'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const userA = guid('aaaaaaaa')
const userB = guid('bbbbbbbb')
const mailType = guid('cccccccc')
const customerEasy = guid('dddddddd')
const fileA = guid('11111111')

function file(id: string): SelectedPatentFile {
  return {
    fileId: id, fileName: '证书', fileDescription: '专利证书', customerName: '客户A', customerProfileId: 'profile-a',
    customerBinding: { profileId: 'profile-a', profileName: '客户A', sourceCustomerName: '客户A', confirmed: true, source: 'explicit' }
  }
}
function profile(easy = customerEasy): CustomerQueryProfile {
  return { id: 'profile-a', name: '客户A', easyCustomerId: easy, baseTemplateId: 'base', overrides: {}, enabled: true, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }
}
function rules(): MailRuleBundle {
  return {
    ...emptyMailRules(userA), revision: 2,
    policies: [{ customerProfileId: 'profile-a', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    mappings: [{ id: 'map-1', fileDescriptionText: '专利证书', mailTypeId: mailType, mailTypeName: '证书通知', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    recipients: [{ id: 'to-a', customerProfileId: 'profile-a', name: '默认', to: ['a@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    signatures: [{ id: 'sign', operatorId: userA, name: '默认签名', content: '此致', enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    subject: { template: '关于{文件名称}的通知', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 },
    body: { template: '请查收。', supplement: '', version: 1 }
  }
}
function input(operatorId = userA, files = [file(fileA)], bundle = rules(), profiles = [profile()]): TaskBuildInput {
  return { origin, operatorId, files, rules: bundle, profiles, queryTemplateVersion: 1, now: '2026-09-26T00:00:00.000Z' }
}
function passes(operatorId = userA): LiveAcceptanceRecord[] {
  return READONLY_ACCEPTANCE_CALLS.map(call => ({
    id: call, origin, operatorId, call, startedAt: '2026-09-26T00:00:00.000Z', finishedAt: '2026-09-26T00:00:01.000Z',
    httpStatus: 200, businessStatus: 'matched', requestShape: call, responseShape: 'object(Result)',
    validatedFields: ['userId'], matchedWithUi: true, result: 'PASS' as const, reason: '对照字段一致。', evidenceHash: 'abc'
  }))
}
function scope(operatorId = userA): TestExecutionScope {
  return { allowedCustomerIds: [customerEasy], allowedFileIds: [fileA], allowedMailIds: [], allowedOrigin: origin, operatorId }
}

describe('用户命名空间与快照', () => {
  it('does not persist or list tasks before the operator guid is confirmed', async () => {
    const store = new MemoryTaskRepository()
    const service = new AutomationTaskService(store)
    const empty = await service.createTask(input(''))
    const fake = await service.createTask(input('session'))
    expect(empty.persisted).toBe(false)
    expect(fake.persisted).toBe(false)
    expect(store.tasks).toHaveLength(0)
    expect(await service.listTasks(origin, '')).toEqual([])
    expect(await service.listTasks(origin, 'session')).toEqual([])
    const saved = await service.createTask(input(userA))
    expect(saved.persisted).toBe(true)
    expect(await service.listTasks(origin, userB)).toEqual([])
    expect((await service.listTasks(origin, userA)).map(item => item.operatorId)).toEqual([userA])
  })

  it('keeps the frozen snapshot when the live rules, binding or customer id change', () => {
    const source = input()
    const task = buildTask(source)
    source.rules.subject.template = '改过的标题'
    source.rules.recipients[0]!.to[0] = 'b@example.com'
    source.files[0]!.customerBinding!.confirmed = false
    source.profiles[0]!.easyCustomerId = guid('eeeeeeee')
    expect(task.ruleSnapshot.subject.template).toBe('关于{文件名称}的通知')
    expect(task.ruleSnapshot.recipients[0]?.to).toEqual(['a@example.com'])
    expect(task.selectedFiles[0]?.customerBinding?.confirmed).toBe(true)
    expect(task.identitySnapshot[0]?.easyCustomerId).toBe(customerEasy)
    expect(task.identitySnapshot[0]?.easyCustomerId).not.toBe(task.identitySnapshot[0]?.profileId)
    expect(validateTask(task, input(userA, [file(fileA)], rules(), [profile(guid('eeeeeeee'))])).status).toBe('STALE')
    const forward = rules()
    forward.mappings = [...forward.mappings, { ...forward.mappings[0]!, id: 'map-2', fileDescriptionText: '另一描述' }]
    const backward = rules()
    backward.mappings = [...forward.mappings].reverse()
    expect(taskFingerprint(input(userA, [file(fileA)], forward))).toBe(taskFingerprint(input(userA, [file(fileA)], backward)))
  })
})

describe('租约与迁移', () => {
  it('releases an unsent lease and keeps a sent lease unknown', async () => {
    const store = memoryTransactionStore()
    const ledger = new ExecutionLedger(store, 'tab-a')
    const claimed = await ledger.claim(origin, userA, 'finger')
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    const restarted = new ExecutionLedger(store, 'worker')
    expect((await restarted.recover(origin, userA)).find(item => item.executionId === claimed.lease.executionId)?.status).toBe('RELEASED')
    const again = await ledger.claim(origin, userA, 'finger')
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const prepared = await ledger.markPrepared(again.lease.executionId, again.lease.leaseVersion)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok || !prepared.lease) return
    const sent = await ledger.markSent(prepared.lease.executionId, prepared.lease.leaseVersion, 'MAIL_CREATE')
    expect(sent.ok).toBe(true)
    if (!sent.ok || !sent.lease) return
    const sentLease = sent.lease
    expect(sentLease.leaseVersion).toBe(prepared.lease.leaseVersion + 1)
    const stale = await ledger.markSent(sentLease.executionId, prepared.lease.leaseVersion, 'MAIL_CREATE')
    expect(stale.ok).toBe(false)
    expect((await restarted.recover(origin, userA)).find(item => item.executionId === sentLease.executionId)?.status).toBe('UNKNOWN')
    expect((await ledger.claim(origin, userA, 'finger')).ok).toBe(false)
    const tasks = new MemoryTaskRepository()
    const denied = await handleAuthorityMessage({
      type: MessageType.MarkExecutionSent,
      payload: { origin, operatorId: userA, taskFingerprint: 'finger', executionId: sentLease.executionId, leaseVersion: 1 }
    }, { ledger, tasks, evidence: new MemoryEvidenceStore() })
    expect(denied?.type === MessageType.ExecutionLease && denied.payload.ok).toBe(false)
  })

  it('keeps both the migrated task and a task saved during migration', async () => {
    const legacy = buildTask(input())
    legacy.taskId = 'task-legacy'
    const store = new SerialTaskStore({ version: 1, tasks: [legacy], migrations: [] })
    const created = buildTask(input())
    await Promise.all([store.list(origin, userA), store.save(created)])
    const tasks = await store.list(origin, userA, true)
    expect(tasks.some(item => item.legacyTaskId === 'task-legacy' || item.taskId === 'task-legacy')).toBe(true)
    expect(tasks.some(item => item.taskId === created.taskId)).toBe(true)
    expect(new Set(tasks.map(item => item.taskId)).size).toBe(tasks.length)
  })
})

describe('验收、契约与测试写', () => {
  it('blocks write calls, 502, expired sessions, field mismatches and mock substitutes', async () => {
    let calls = 0
    const live = new LiveEasyAcceptanceRunner({
      kind: 'live',
      call: async (name): Promise<{ httpStatus: number; sessionOk: boolean; fields: Record<string, string>; shape: string }> => {
        calls += 1
        if (name === 'GetFlowSubmit') return { httpStatus: 502, sessionOk: true, fields: {}, shape: 'empty' }
        if (name === 'GetSearchFiles') return { httpStatus: 200, sessionOk: true, fields: { file_id: 'other' }, shape: 'object(file_id)' }
        if (name === 'GetMailInfo') return { httpStatus: 200, sessionOk: false, fields: {}, shape: 'empty' }
        return { httpStatus: 200, sessionOk: true, fields: { userId: userA }, shape: 'object(UserModel)' }
      }
    })
    const write = await live.run({ origin, operatorId: userA, call: 'MailCustomer' })
    expect(write.result).toBe('BLOCKED')
    expect(calls).toBe(0)
    expect((await live.run({ origin, operatorId: userA, call: 'GetFlowSubmit' })).result).toBe('FAIL')
    expect((await live.run({ origin, operatorId: userA, call: 'GetMailInfo' })).reason).toContain('登录')
    expect((await live.run({ origin, operatorId: userA, call: 'GetSearchFiles', expected: { file_id: fileA } })).result).toBe('FAIL')
    let mocked = 0
    const mock = new LiveEasyAcceptanceRunner({ kind: 'mock', call: async () => { mocked += 1; return { httpStatus: 200, sessionOk: true, fields: { userId: userA }, shape: 'object()' } } })
    expect((await mock.run({ origin, operatorId: userA, call: 'GetUserModel' })).result).toBe('BLOCKED')
    expect(mocked).toBe(0)
    expect(ContractVerifierRegistry.MailCustomer?.validateResponse(200, { Status: false }).ok).toBe(false)
    expect(ContractVerifierRegistry.MailCustomer?.validateResponse(200, { objid: '1' }).ok).toBe(false)
    expect(ContractVerifierRegistry.MailCustomer?.validateReadback({ mailId: 'a', fileIds: '1' }, { mailId: 'b', fileIds: '1' }).ok).toBe(false)
    expect(evidenceLevelOf({ source: 'MOCK', businessSuccess: true, readbackMatched: true, requestShape: 'Call' })).toBe('UNKNOWN')
    expect(evidenceLevelOf({ source: 'LIVE', businessSuccess: true, readbackMatched: false, requestShape: 'Call' })).toBe('RESPONSE_OBSERVED')
    expect(executionMode('PRODUCTION_WRITE')).toBeNull()
    expect(mailWritesEnabled()).toBe(true)
    expect(workflowWritesEnabled()).toBe(true)
    expect(isMessage({ type: MessageType.MarkExecutionSent, payload: { origin, operatorId: userA, taskFingerprint: 'a'.repeat(64), executionId: 'exec', leaseVersion: 1 } })).toBe(true)
  })

  it('redacts har entries and refuses a write until markSent succeeds', async () => {
    const rows = importHar({
      log: { entries: [
        {
          startedDateTime: '2026-09-26T00:00:00.000Z',
          request: {
            method: 'POST', url: `${origin}/AjaxServers/Notice.ashx`,
            headers: [{ name: 'Cookie', value: 'secret' }, { name: 'Authorization', value: 'Bearer secret' }],
            postData: { mimeType: 'application/x-www-form-urlencoded', text: 'Call=MailCustomer&mail_body=正文&mail_to=a@example.com&_file_ids=1' }
          },
          response: { status: 200, headers: [{ name: 'Set-Cookie', value: 'secret' }], content: { text: '{"objid":"1","note":"a@example.com"}' } }
        },
        {
          request: { method: 'POST', url: 'http://evil.example/AjaxServers/Notice.ashx', postData: { text: 'Call=MailCustomer' } },
          response: { status: 200, content: { text: '{}' } }
        },
        {
          request: { method: 'POST', url: `${origin}/AjaxServers/CaseInfo.ashx`, postData: { text: 'Call=NotARealCall' } },
          response: { status: 200, content: { text: '{}' } }
        }
      ] }
    }, origin, userA)
    const text = JSON.stringify(rows)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('a@example.com')
    expect(text).not.toContain('正文')
    expect(rows.map(item => item.call)).toEqual(['MailCustomer'])
    const ledger = new ExecutionLedger(memoryTransactionStore(), 'tab')
    let fetches = 0
    const evidence = [sealEvidence({
      handler: '/AjaxServers/Notice.ashx', call: 'MailCustomer', origin, operatorId: userA,
      requestShape: '_file_ids,mailstyle', responseShape: 'object(objid)', httpStatus: 200,
      businessSuccess: false, readbackCall: 'GetMailInfo', readbackMatched: false, source: 'CAPTURED_HAR',
      capturedAt: '2026-09-26T00:00:00.000Z', verifiedAt: ''
    })]
    const blocked = await runControlledWrite({
      mode: 'TEST_WRITE', task: buildTask(input()), itemId: 'item', stage: 'MAIL_CREATE', scope: scope(),
      acceptance: [], evidence, userConfirmed: true, authority: ledger,
      checkpoints: new CheckpointService({ save: async () => undefined }),
      fetchWrite: async () => { fetches += 1; return { mailId: fileA } },
      readback: async () => ({ matched: true, mailId: fileA })
    })
    expect(blocked.requested).toBe(false)
    expect(fetches).toBe(0)
    const authority = new ExecutionLedger(memoryTransactionStore(), 'tab')
    authority.markSent = async () => ({ ok: false, lease: null, reason: '发送标记没有成功。' })
    const unsent = await runControlledWrite({
      mode: 'TEST_WRITE', task: buildTask(input()), itemId: 'item', stage: 'MAIL_CREATE', scope: scope(),
      acceptance: passes(), evidence, userConfirmed: true, authority,
      checkpoints: new CheckpointService({ save: async () => undefined }),
      fetchWrite: async () => { fetches += 1; return { mailId: fileA } },
      readback: async () => ({ matched: true, mailId: fileA })
    })
    expect(unsent.requested).toBe(false)
    expect(fetches).toBe(0)
    const checkpointDenied = await runControlledWrite({
      mode: 'TEST_WRITE', task: buildTask(input()), itemId: 'item', stage: 'MAIL_CREATE', scope: scope(),
      acceptance: passes(), evidence, userConfirmed: true, authority: new ExecutionLedger(memoryTransactionStore(), 'tab'),
      checkpoints: new CheckpointService({ save: async () => { throw new Error('full') } }),
      fetchWrite: async () => { fetches += 1; return { mailId: fileA } },
      readback: async () => ({ matched: true, mailId: fileA })
    })
    expect(checkpointDenied.requested).toBe(false)
    expect(fetches).toBe(0)
    const unknownLedger = new ExecutionLedger(memoryTransactionStore(), 'tab')
    const unknown = await runControlledWrite({
      mode: 'TEST_WRITE', task: buildTask(input()), itemId: 'item', stage: 'MAIL_CREATE', scope: scope(),
      acceptance: passes(), evidence, userConfirmed: true, authority: unknownLedger,
      checkpoints: new CheckpointService({ save: async () => undefined }),
      fetchWrite: async () => { fetches += 1; throw new Error('timeout') },
      readback: async () => ({ matched: true, mailId: fileA })
    })
    expect(unknown.unknown).toBe(true)
    expect(fetches).toBe(1)
    expect((await unknownLedger.claim(origin, userA, buildTask(input()).taskFingerprint)).ok).toBe(false)
  })
})
