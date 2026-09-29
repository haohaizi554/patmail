import { describe, expect, it, vi } from 'vitest'
import { EasyRuntime } from '../src/api/client'
import { EasyTransport } from '../src/api/transport'
import { CONTRACT_EVIDENCE } from '../src/automation/contract-evidence'
import { CROSS_TAB_WRITE_EXCLUSION_PROVEN, ExecutionCoordinator, processLocalLock, type LockProvider } from '../src/automation/coordinator'
import { markRequestSent, markUnknown } from '../src/automation/checkpoint'
import { runDryRun } from '../src/automation/dry-run'
import { prepareStage } from '../src/automation/executor'
import { exportDiagnostic } from '../src/automation/logger'
import { recoverTask } from '../src/automation/recovery'
import { MemoryTaskRepository } from '../src/automation/repository'
import { WRITE_STAGES } from '../src/automation/state'
import { buildTask, taskFingerprint, type TaskBuildInput } from '../src/automation/task-builder'
import { validateTask } from '../src/automation/task-validator'
import { mailWritesEnabled } from '../src/mail/easy/gate'
import { emptyMailRules } from '../src/mail'
import type { CustomerQueryProfile } from '../src/customer/types'
import type { MailRuleBundle, SelectedPatentFile } from '../src/mail/types'
import { isMessage, MessageType } from '../src/shared/message'
import { WORKFLOW_CONTRACT, workflowWritesEnabled } from '../src/workflow/gate'
import { reviewersForNode } from '../src/workflow/reviewer-resolver'
import { canReplan, nextWorkflowState } from '../src/workflow/state'
import { MemoryWorkflowStore } from '../src/workflow/store'
import { WorkflowRuntime } from '../src/workflow/runtime'
import type { WorkflowExecutionRecord } from '../src/workflow/types'

const origin = 'http://183.36.43.66:88'
const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const user = guid('aaaaaaaa')
const other = guid('bbbbbbbb')
const mailType = guid('cccccccc')
const fileA = guid('11111111')
const fileB = guid('22222222')
const mailId = guid('083aa041')
const flowId = guid('f10f10f1')
const nextNode = guid('d0d0d0d0')
const otherNode = guid('e1e1e1e1')
const urgency = guid('e0e0e0e0')
const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }
const mockPage = { score: '0', finishDate: '2026-09-26', picUser: '', intDueDate: '', cusDueDate: '', legDueDate: '', source: 'mock-page' as const }

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
    ...emptyMailRules(user),
    revision: 2,
    policies: [
      { customerProfileId: 'profile-a', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' },
      { customerProfileId: 'profile-b', sendMode: 'merge_by_customer_description', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }
    ],
    mappings: [{ id: 'map-1', fileDescriptionText: '专利证书', mailTypeId: mailType, mailTypeName: '证书通知', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }],
    recipients: [
      { id: 'to-a', customerProfileId: 'profile-a', name: '默认', to: ['a@example.com'], cc: ['cc@example.com'], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' },
      { id: 'to-b', customerProfileId: 'profile-b', name: '默认', to: ['b@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }
    ],
    subject: { template: '关于{文件名称}的通知', countInjection: false, anchor: '关于', missingAnchor: 'keep', version: 1 },
    body: { template: '请查收{文件数量}个文件。', supplement: '', version: 1 },
    ...partial
  }
}
function input(files: SelectedPatentFile[], bundle = rules(), version = 1): TaskBuildInput {
  return { origin, operatorId: user, files, rules: bundle, profiles: [profile('profile-a', '客户A'), profile('profile-b', '客户B')], queryTemplateVersion: version, now: '2026-09-26T00:00:00.000Z' }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function flowRow(token = '', node = '') {
  return {
    obj_id: mailId, flow_id: flowId, flow_type: 'CO', flow_sub_type: '', cur_node_id: node, node_code: node ? 'REV' : 'STA',
    node_name_zh_cn: node ? '审核' : '开始', status: -1, dept_id: 'base', dept_full_name: '', cur_user_id: user, cn_name: '本人',
    is_skip: false, is_enabled: true, urgency_id: urgency, update_time: '', update_time_dd: '', update_time_mm: '', update_time_ss: token, user_list: ''
  }
}
function node(id: string, people: Array<{ user_id: string; cn_name: string }>) {
  return {
    list_id: 'L1', seq: 1, next: id, node_id: id, node_code: 'REV', node_name_zh_cn: id === nextNode ? '审核' : '复核', allow_skip: false,
    user_type: 'U', user_list: people, need_all_audit: 0, is_parallel: 0
  }
}
function flowFetcher(options: { token?: () => string; nodes?: unknown[] } = {}): typeof fetch {
  return async (_url, init) => {
    const call = new URLSearchParams(String(init?.body)).get('Call')
    if (call === 'GetFlowInfo') return json({ ...client, Result: flowRow(options.token?.() ?? '') })
    if (call === 'GetFlowHistory') return json({
      ...client, Result: [],
      flow_activity: { node_id: '', node_code: 'STA', node_name: '开始', status: -1, allow_edit: true, audit_user_id: user, audit_cn_name: '本人' }
    })
    if (call === 'GetUrgencyList') return json({ ...client, UrgencyList: [{ urgency_id: urgency, urgency_code: '01', urgency_name: '普通', seq: 1 }] })
    if (call === 'GetFlowSubmit') return json({ ...client, Result: options.nodes ?? [node(nextNode, [{ user_id: user, cn_name: '本人' }])] })
    if (call === 'GetFlowLastStatus') return json({ ...client, last_status: null })
    return json(client)
  }
}
function flowRuntime(fetcher: typeof fetch, store = new MemoryWorkflowStore(), mock?: (params: Record<string, string>) => Promise<{ status: 'accepted' | 'rejected' | 'unknown' }>) {
  return new WorkflowRuntime(new EasyTransport(origin, { fetcher }), store, { blockers: () => [] }, origin, async () => true, { mockSubmit: mock })
}
function planInput(nodeId = '', reviewerId = '', remark = '') {
  return { currentUserId: user, nodeId, reviewerId, auditType: 'submit' as const, remark, urgencyId: urgency, pageFields: mockPage }
}
function memoryArea() {
  const data: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(data, items) }
  }
}
function sharedLock(): LockProvider {
  let chain: Promise<unknown> = Promise.resolve()
  return {
    exclusive(_name, run) {
      const current = chain.then(run, run)
      chain = current.then(() => undefined, () => undefined)
      return current
    }
  }
}
function blankRecord(status: WorkflowExecutionRecord['status'], requestSent = false): WorkflowExecutionRecord {
  return {
    executionId: 'e1', mailId, flowType: 'CO', flowId, currentNodeId: '', nextNodeId: '', reviewerId: '',
    status, versionToken: '', submittedAt: '', lastVerifiedAt: '', lastError: '', requestSent, userId: user, origin
  }
}

describe('Phase 2.6 重新规划', () => {
  it('drops the old plan when the node, reviewer, urgency or remark changes', async () => {
    const nodes = [
      node(nextNode, [{ user_id: user, cn_name: '本人' }]),
      node(otherNode, [{ user_id: other, cn_name: '他人' }, { user_id: user, cn_name: '本人' }])
    ]
    const flow = flowRuntime(flowFetcher({ nodes }))
    const opened = await flow.read(user, mailId, 'CO')
    const first = await flow.preview(user, opened.record.executionId, planInput(nextNode, user, '第一版'))
    expect(first.record.status).toBe('CONFIRM_REQUIRED')
    expect(first.record.nextNodeId).toBe(nextNode)
    expect(first.plan?.remark).toBe('第一版')
    const second = await flow.preview(user, opened.record.executionId, planInput(otherNode, user, '第二版'))
    expect(second.record.nextNodeId).toBe(otherNode)
    expect(second.record.reviewerId).toBe(user)
    expect(second.plan?.remark).toBe('第二版')
    expect(second.plan?.node.nodeId).toBe(otherNode)
    expect(second.record.requestSent).toBe(false)
    const refused = await flow.preview(user, opened.record.executionId, planInput(otherNode, other, '换人'))
    expect(refused.record.status).toBe('BLOCKED')
    expect(refused.record.reviewerId).toBe('')
    expect(refused.plan).toBeNull()
    expect(reviewersForNode(opened.snapshot?.availableNodes ?? [], nextNode).map(item => item.id)).toEqual([user])
    expect(reviewersForNode(opened.snapshot?.availableNodes ?? [], otherNode).map(item => item.id)).toEqual([other, user])
    expect(reviewersForNode(opened.snapshot?.availableNodes ?? [], '').length).toBe(0)
  })

  it('discards a plan when refresh sees a new flow version and restores a readonly view', async () => {
    let token = 'A'
    const store = new MemoryWorkflowStore()
    const flow = flowRuntime(flowFetcher({ token: () => token }), store)
    const opened = await flow.read(user, mailId, 'CO')
    const planned = await flow.preview(user, opened.record.executionId, planInput(nextNode, user))
    expect(planned.record.status).toBe('CONFIRM_REQUIRED')
    token = 'B'
    const refreshed = await flow.refresh(user, planned.record.executionId)
    expect(refreshed.record.versionToken).toBe('B')
    expect(refreshed.record.nextNodeId).toBe('')
    expect(refreshed.plan).toBeNull()
    expect(refreshed.record.status).toBe('READY')
    const restarted = flowRuntime(flowFetcher({ token: () => token }), store)
    const restored = await restarted.restore(user, mailId)
    expect(restored?.record.status).toBe('READY')
    expect(restored?.plan).toBeNull()
    expect(restored?.snapshot?.versionToken).toBe('B')
    const again = await restarted.preview(user, restored?.record.executionId ?? '', planInput(nextNode, user))
    expect(again.record.status).toBe('CONFIRM_REQUIRED')
  })

  it('turns an interrupted submit into UNKNOWN and does not send it again', async () => {
    let submits = 0
    const store = new MemoryWorkflowStore()
    const flow = flowRuntime(flowFetcher(), store)
    const opened = await flow.read(user, mailId, 'CO')
    const planned = await flow.preview(user, opened.record.executionId, planInput(nextNode, user))
    expect(planned.record.status).toBe('CONFIRM_REQUIRED')
    const crashed = store.records.find(item => item.executionId === planned.record.executionId)
    if (!crashed) throw new Error('缺少执行记录')
    crashed.status = 'SUBMITTING'
    crashed.requestSent = true
    const restarted = flowRuntime(flowFetcher(), store, async () => {
      submits += 1
      return { status: 'accepted' }
    })
    const restored = await restarted.restore(user, mailId)
    expect(restored?.record.status).toBe('UNKNOWN')
    expect(restored?.record.requestSent).toBe(true)
    expect(restored?.record.lastError).toContain('没有自动重试')
    const retried = await restarted.submit(user, restored?.record.executionId ?? '', true)
    expect(retried.record.status).toBe('UNKNOWN')
    expect(submits).toBe(0)
    expect(canReplan(blankRecord('UNKNOWN', true))).toBe(false)
    expect(canReplan(blankRecord('SUBMITTING', true))).toBe(false)
    expect(canReplan(blankRecord('CONFIRM_REQUIRED', false))).toBe(true)
    expect(nextWorkflowState('UNKNOWN', 'PLAN_INVALIDATED')).toBeNull()
    expect(nextWorkflowState('PREVIEW_READY', 'PLAN_INVALIDATED')).toBe('READY')
  })
})

describe('Dry-run', () => {
  it('merges one customer and description, splits the rest, and never calls fetch', () => {
    const calls: string[] = []
    const transport = new EasyTransport(origin, { fetcher: async (_url, init) => {
      calls.push(new URLSearchParams(String(init?.body)).get('Call') ?? '')
      return json(client)
    } })
    const merged = runDryRun(input([file(fileA, 'profile-a', '专利证书', '专利文件1'), file(fileB, 'profile-a', '专利证书', '专利文件2')]), transport)
    expect(merged.task.status).toBe('DRY_RUN_COMPLETED')
    expect(merged.task.items).toHaveLength(1)
    expect(merged.task.items[0]?.fileNames).toEqual(['专利文件1', '专利文件2'])
    expect(merged.task.items[0]?.mailTypeName).toBe('证书通知')
    expect(merged.task.items[0]?.mailDraftPreview?.to).toEqual(['a@example.com'])
    expect(merged.writeCalls).toEqual([])
    expect(calls).toEqual([])
    const split = runDryRun(input([file(fileA, 'profile-a', '专利证书'), file(fileB, 'profile-a', '审查意见')]))
    expect(split.task.items.map(item => item.status)).toEqual(['DRY_RUN_COMPLETED', 'BLOCKED'])
    expect(split.task.status).toBe('BLOCKED')
    expect(split.task.issues.some(item => item.code === 'MISSING_MAPPING' || item.code === 'MISSING_DESCRIPTION')).toBe(true)
    const single = runDryRun(input([file(fileA, 'profile-a', '专利证书'), file(fileB, 'profile-a', '专利证书')], rules({
      policies: [{ customerProfileId: 'profile-a', sendMode: 'single_file', enabled: true, version: 1, updatedAt: '2026-09-24T00:00:00.000Z' }]
    })))
    expect(single.task.items).toHaveLength(2)
    expect(single.task.items.every(item => item.sendMode === 'single_file')).toBe(true)
    const isolated = runDryRun(input([file(fileA, 'profile-a', '专利证书'), file(fileB, 'profile-b', '专利证书')]))
    expect(isolated.task.items.map(item => item.customerProfileId).sort()).toEqual(['profile-a', 'profile-b'])
    const noRecipient = runDryRun(input([file(fileA, 'profile-a', '专利证书')], rules({ recipients: [] })))
    expect(noRecipient.task.items[0]?.issues.some(item => item.code === 'MISSING_RECIPIENT')).toBe(true)
    expect(noRecipient.task.status).toBe('BLOCKED')
    const unbound = runDryRun(input([{ ...file(fileA, 'profile-a', '专利证书'), customerProfileId: '', customerBinding: undefined }]))
    expect(unbound.task.status).toBe('BLOCKED')
    expect(unbound.task.issues.some(item => item.code === 'MISSING_CUSTOMER' || item.code === 'MISSING_POLICY')).toBe(true)
  })

  it('marks a forged fingerprint or a changed rule revision as stale', () => {
    const current = input([file(fileA, 'profile-a', '专利证书')])
    const task = buildTask(current)
    const forged = { ...task, taskFingerprint: 'caller-supplied' }
    expect(validateTask(forged, current).status).toBe('STALE')
    const renamed = input([file(fileA, 'profile-a', '专利证书', '另一份')])
    renamed.files[0] = { ...renamed.files[0]!, fileName: '另一份' }
    const lied = { ...task, taskFingerprint: taskFingerprint(renamed) }
    expect(validateTask(lied, renamed).status).toBe('STALE')
    expect(validateTask(lied, renamed).issues.some(item => item.code === 'STALE_TASK')).toBe(true)
    const revised = input([file(fileA, 'profile-a', '专利证书')], rules({ revision: 9 }))
    expect(validateTask(task, revised).status).toBe('STALE')
    const otherVersion = input([file(fileA, 'profile-a', '专利证书')], rules(), 8)
    expect(validateTask(task, otherVersion).issues.some(item => item.code === 'STALE_TASK')).toBe(true)
    const otherAccount = { ...current, operatorId: other }
    expect(validateTask(task, otherAccount).issues.some(item => item.code === 'ACCOUNT_MISMATCH')).toBe(true)
    expect(validateTask(task, { ...current, operatorId: 'session' }).issues.some(item => item.code === 'SESSION_USER')).toBe(true)
  })
})

describe('执行协调与恢复', () => {
  it('allows one owner per fingerprint and keeps a second fingerprint independent', async () => {
    const area = memoryArea()
    const lock = sharedLock()
    const left = new ExecutionCoordinator(area, lock, 'tab-a')
    const right = new ExecutionCoordinator(area, lock, 'tab-b')
    const first = await left.claim(origin, user, 'finger-1')
    const second = await right.claim(origin, user, 'finger-1')
    const third = await right.claim(origin, user, 'finger-2')
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(third.ok).toBe(true)
  })

  it('cannot prove exclusion when each tab has its own lock and storage writes overlap', async () => {
    let release: () => void = () => undefined
    const wait = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    const data: Record<string, unknown> = {}
    const area = {
      get: async (key: string) => ({ [key]: data[key] }),
      set: async (items: Record<string, unknown>) => {
        writes += 1
        if (writes === 1) await wait
        Object.assign(data, items)
      }
    }
    const left = new ExecutionCoordinator(area, processLocalLock(), 'tab-a')
    const right = new ExecutionCoordinator(area, processLocalLock(), 'tab-b')
    const first = left.claim(origin, user, 'same')
    await vi.waitFor(() => expect(writes).toBe(1))
    const second = right.claim(origin, user, 'same')
    await new Promise(resolve => setTimeout(resolve, 20))
    release()
    const [claimedLeft, claimedRight] = await Promise.all([first, second])
    expect(claimedLeft.ok && claimedRight.ok).toBe(true)
    expect(CROSS_TAB_WRITE_EXCLUSION_PROVEN).toBe(false)
    expect(WORKFLOW_CONTRACT.crossTabCreateAtomic).toBe(false)
  })

  it('recovers a sent request after a coordinator restart and blocks a second claim', async () => {
    const area = memoryArea()
    const first = new ExecutionCoordinator(area, processLocalLock(), 'worker-1')
    const claimed = await first.claim(origin, user, 'finger')
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    await first.markSent(origin, user, claimed.lease.executionId, 'MAIL_CREATE')
    const restarted = new ExecutionCoordinator(area, processLocalLock(), 'worker-2')
    const recovered = await restarted.recover(origin, user)
    expect(recovered[0]?.status).toBe('UNKNOWN')
    expect(recovered[0]?.requestSent).toBe(true)
    const again = await restarted.claim(origin, user, 'finger')
    expect(again.ok).toBe(false)
    const peer = new ExecutionCoordinator(area, sharedLock(), 'worker-3')
    const raced = await Promise.all([restarted.recover(origin, user), peer.recover(origin, user)])
    expect(raced.flat().every(item => item.status === 'UNKNOWN')).toBe(true)
    expect(await peer.claim(origin, user, 'finger')).toMatchObject({ ok: false })
  })

  it('records a write checkpoint before the call and stops unknown creates', () => {
    const task = buildTask(input([file(fileA, 'profile-a', '专利证书')]))
    const sent = markRequestSent(task, 'MAIL_CREATE')
    expect(sent.checkpoints.at(-1)?.requestSent).toBe(true)
    expect(sent.checkpoints.at(-1)?.stage).toBe('MAIL_CREATE')
    const unknown = markUnknown(sent, 'MAIL_CREATE')
    expect(recoverTask(unknown)).toMatchObject({ action: 'stop', stage: 'MAIL_CREATE' })
    expect(recoverTask(markUnknown(sent, 'MAIL_SAVE')).action).toBe('reread-mail')
    expect(recoverTask(markUnknown(sent, 'FILE_BIND')).action).toBe('reread-files')
    expect(recoverTask(markUnknown(sent, 'WORKFLOW_SUBMIT')).action).toBe('reread-flow')
    expect(recoverTask(markUnknown(sent, 'REVIEW_EXECUTE')).action).toBe('pending')
    const mixed = {
      ...unknown,
      items: unknown.items.map((item, index) => ({ ...item, status: index === 0 ? 'COMPLETED' as const : 'UNKNOWN' as const }))
    }
    expect(recoverTask(mixed).action).toBe('stop')
    expect(mixed.items[0]?.status).toBe('COMPLETED')
    const prepared = prepareStage(task, 'MAIL_CREATE')
    expect(prepared.decision).toBe('blocked')
    expect(prepared.task.checkpoints).toHaveLength(0)
    expect(prepareStage(unknown, 'MAIL_SAVE').decision).toBe('unknown-stop')
    expect(prepareStage(task, 'WORKFLOW_READ').decision).toBe('read')
    expect(WRITE_STAGES).toEqual(['MAIL_CREATE', 'MAIL_SAVE', 'FILE_BIND', 'WORKFLOW_SUBMIT', 'REVIEW_EXECUTE'])
  })

  it('keeps tasks inside one account and rejects secret diagnostics', async () => {
    const repo = new MemoryTaskRepository()
    const task = buildTask(input([file(fileA, 'profile-a', '专利证书')]))
    await repo.save(task)
    await repo.save({ ...task, taskId: 'other-task', operatorId: other })
    expect((await repo.list(origin, user)).map(item => item.taskId)).toEqual([task.taskId])
    expect(exportDiagnostic([{ taskId: task.taskId, executionId: '', itemId: '', stage: 'DRAFT_VALIDATE', event: 'dry-run', status: 'BLOCKED', durationMs: 1, errorCode: 'MISSING_RECIPIENT', timestamp: task.updatedAt }])).toContain('MISSING_RECIPIENT')
    expect(() => exportDiagnostic([{ taskId: task.taskId, executionId: '', itemId: '', stage: 'DRAFT_VALIDATE', event: 'cookie=secret', status: 'BLOCKED', durationMs: 1, errorCode: '', timestamp: task.updatedAt }])).toThrow(/凭证/)
  })
})

describe('接口契约与写开关', () => {
  it('defaults the write switch open and does not treat 502 as GetFlowSubmit success', async () => {
    expect(mailWritesEnabled()).toBe(true)
    expect(workflowWritesEnabled()).toBe(true)
    expect(CONTRACT_EVIDENCE.find(item => item.call === 'GetFlowSubmit')).toMatchObject({ responseCaptured: false, status: 'pending' })
    expect(CONTRACT_EVIDENCE.find(item => item.call === 'FlowSubmit')?.responseCaptured).toBe(false)
    expect(CONTRACT_EVIDENCE.find(item => item.call === 'EndEmailFlowd')?.source).toBe('unverified')
    expect(CONTRACT_EVIDENCE.find(item => item.call === 'MailCustomer')?.responseCaptured).toBe(false)
    const calls: string[] = []
    const runtime = new EasyRuntime(origin, {
      fetcher: async (_url, init) => {
        const call = new URLSearchParams(String(init?.body)).get('Call') ?? ''
        calls.push(call)
        if (call === 'GetUserModel') return json({ ...client, UserModel: { user_id: user, user_name: 'tester', Name: '测试员' } })
        if (call === 'GetFlowSubmit') return json({ ...client }, 502)
        if (call === 'GetFlowInfo') return json({ ...client, Result: flowRow() })
        if (call === 'GetFlowHistory') return json({
      ...client, Result: [],
      flow_activity: { node_id: '', node_code: 'STA', node_name: '开始', status: -1, allow_edit: true, audit_user_id: user, audit_cn_name: '本人' }
    })
        if (call === 'GetUrgencyList') return json({ ...client, UrgencyList: [] })
        return json(client)
      }
    })
    const diagnostic = await runtime.diagnoseExistingMail(mailId, 'CO')
    expect(diagnostic.writesAttempted).toBe(false)
    expect(calls.some(call => ['MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd'].includes(call))).toBe(false)
    expect(diagnostic.workflow.record.status === 'FAILED' || diagnostic.workflow.blockers.join('').length > 0).toBe(true)
    expect(isMessage({ type: MessageType.DiagnoseExistingMail, payload: { mailId, flowType: 'CO' } })).toBe(true)
    expect(isMessage({ type: MessageType.DiagnoseExistingMail, payload: { mailId, flowType: 'CO', submit: true } })).toBe(false)
    expect(isMessage({ type: MessageType.ClaimExecution, payload: { origin, operatorId: user, taskFingerprint: 'finger' } })).toBe(true)
  })
})
