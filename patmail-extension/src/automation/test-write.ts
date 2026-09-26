import type { LiveAcceptanceRecord } from './acceptance-runner'
import { READONLY_ACCEPTANCE_CALLS } from './acceptance-runner'
import type { CheckpointService } from './checkpoint-service'
import { hashOperator, type StoredEvidence } from './evidence-store'
import { isConfirmedOperator } from './operator'
import type { ExecutionLease, StageId } from './types'
import type { AutomationTask } from './types'

export type ExecutionMode = 'DRY_RUN' | 'LIVE_READONLY' | 'TEST_WRITE'

export function executionMode(value: string): ExecutionMode | null {
  if (value === 'DRY_RUN' || value === 'LIVE_READONLY' || value === 'TEST_WRITE') return value
  return null
}

export interface TestExecutionScope {
  allowedCustomerIds: string[]
  allowedFileIds: string[]
  allowedMailIds: string[]
  allowedOrigin: string
  operatorId: string
}

export const CLOSED_TEST_SCOPE: TestExecutionScope = {
  allowedCustomerIds: [],
  allowedFileIds: [],
  allowedMailIds: [],
  allowedOrigin: '',
  operatorId: ''
}

const STAGE_CALL: Partial<Record<StageId, string>> = {
  MAIL_CREATE: 'MailCustomer',
  MAIL_SAVE: 'SaveMailInfo',
  FILE_BIND: 'SaveMailRalteCaseFile',
  WORKFLOW_SUBMIT: 'FlowSubmit'
}

export interface AuditEvent {
  eventId: string
  taskId: string
  itemId: string
  executionId: string
  mode: ExecutionMode
  stage: string
  call: string
  operatorIdHash: string
  origin: string
  requestSent: boolean
  responseReceived: boolean
  readbackVerified: boolean
  result: string
  startedAt: string
  finishedAt: string
  errorCode: string
}

export interface LeaseAuthority {
  claim(origin: string, operatorId: string, taskFingerprint: string): Promise<{ ok: true; lease: ExecutionLease } | { ok: false; lease: ExecutionLease | null; reason: string }>
  markPrepared(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
  markSent(executionId: string, leaseVersion: number, checkpoint: string): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
  markResponse(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
  markVerified(executionId: string, leaseVersion: number, easyMailId?: string): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
  complete(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
  releaseBeforeSend(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
  markUnknown(executionId: string, leaseVersion: number): Promise<{ ok: boolean; lease: ExecutionLease | null; reason: string }>
}

function latestPass(records: LiveAcceptanceRecord[], call: string, origin: string, operatorId: string): boolean {
  return [...records].reverse().find(item => item.call === call && item.origin === origin && item.operatorId === operatorId)?.result === 'PASS'
}

export function evaluateTestWrite(input: {
  mode: string
  task: AutomationTask
  scope: TestExecutionScope
  stage: StageId
  acceptance: LiveAcceptanceRecord[]
  evidence: StoredEvidence[]
  userConfirmed: boolean
}): string[] {
  const blockers: string[] = []
  if (executionMode(input.mode) !== 'TEST_WRITE') blockers.push('当前不是测试写模式。')
  if (!isConfirmedOperator(input.task.operatorId) || input.task.operatorId !== input.scope.operatorId) blockers.push('当前 EASY 用户身份尚未确认。')
  if (input.task.origin !== input.scope.allowedOrigin) blockers.push('站点不在测试范围内。')
  if (input.task.status === 'STALE' || input.task.status === 'UNKNOWN' || input.task.readonly) blockers.push('任务不能执行。')
  if (!READONLY_ACCEPTANCE_CALLS.every(call => latestPass(input.acceptance, call, input.task.origin, input.task.operatorId))) {
    blockers.push('现场只读验收尚未通过。')
  }
  const identities = input.task.identitySnapshot.filter(item => item.confirmed && item.easyCustomerId)
  if (identities.length === 0 || identities.some(item => !input.scope.allowedCustomerIds.includes(item.easyCustomerId))) {
    blockers.push('客户不在测试白名单。')
  }
  const fileIds = input.task.selectedFiles.map(file => file.fileId)
  if (fileIds.length === 0 || fileIds.some(id => !input.scope.allowedFileIds.includes(id))) blockers.push('文件不在测试白名单。')
  const mailIds = input.task.items.map(item => item.easyMailId).filter(Boolean)
  if (mailIds.some(id => !input.scope.allowedMailIds.includes(id))) blockers.push('邮件不在测试白名单。')
  if (!input.userConfirmed) blockers.push('还没有逐项确认。')
  const call = STAGE_CALL[input.stage] ?? ''
  if (!call) blockers.push('这个阶段不能在测试写里执行。')
  if (input.stage === 'WORKFLOW_SUBMIT' && !latestPass(input.acceptance, 'GetFlowSubmit', input.task.origin, input.task.operatorId)) {
    blockers.push('GetFlowSubmit 还没有真实成功响应。')
  }
  const evidence = input.evidence.filter(item => item.call === call && item.source !== 'MOCK')
  if (evidence.length === 0 || !evidence.some(item => item.level !== 'UNKNOWN')) blockers.push('写接口还没有契约证据。')
  return blockers
}

function audit(partial: Omit<AuditEvent, 'eventId' | 'operatorIdHash' | 'finishedAt'> & { operatorId: string }): AuditEvent {
  return {
    ...partial,
    eventId: globalThis.crypto.randomUUID(),
    operatorIdHash: hashOperator(partial.operatorId),
    finishedAt: new Date().toISOString(),
    errorCode: partial.errorCode.slice(0, 80)
  }
}

/** 测试写的单步协议。markSent 失败时不会调用 fetch。未知结果不会自动重试。 */
export async function runControlledWrite(input: {
  mode: ExecutionMode
  task: AutomationTask
  itemId: string
  stage: StageId
  scope: TestExecutionScope
  acceptance: LiveAcceptanceRecord[]
  evidence: StoredEvidence[]
  userConfirmed: boolean
  authority: LeaseAuthority
  checkpoints: CheckpointService
  fetchWrite: () => Promise<{ mailId: string }>
  readback: (mailId: string) => Promise<{ matched: boolean; mailId: string }>
}): Promise<{ requested: boolean; unknown: boolean; verified: boolean; blockers: string[]; audit: AuditEvent }> {
  const startedAt = new Date().toISOString()
  const call = STAGE_CALL[input.stage] ?? input.stage
  const blockers = input.stage === 'REVIEW_EXECUTE'
    ? ['本阶段不执行结束流程或审核。']
    : evaluateTestWrite(input)
  const base = {
    taskId: input.task.taskId, itemId: input.itemId, executionId: '', mode: input.mode, stage: input.stage, call,
    operatorId: input.task.operatorId, origin: input.task.origin, requestSent: false, responseReceived: false,
    readbackVerified: false, result: 'BLOCKED', startedAt, errorCode: blockers[0] ?? ''
  }
  if (blockers.length > 0) return { requested: false, unknown: false, verified: false, blockers, audit: audit(base) }
  const claimed = await input.authority.claim(input.task.origin, input.task.operatorId, input.task.taskFingerprint)
  if (!claimed.ok) return { requested: false, unknown: false, verified: false, blockers: [claimed.reason], audit: audit({ ...base, errorCode: claimed.reason }) }
  const prepared = await input.checkpoints.prepare(input.task, input.itemId, input.stage)
  if (!prepared.ok) {
    await input.authority.releaseBeforeSend(claimed.lease.executionId, claimed.lease.leaseVersion)
    return { requested: false, unknown: false, verified: false, blockers: [prepared.reason], audit: audit({ ...base, executionId: claimed.lease.executionId, errorCode: prepared.reason }) }
  }
  const ready = await input.authority.markPrepared(claimed.lease.executionId, claimed.lease.leaseVersion)
  if (!ready.ok || !ready.lease) {
    await input.authority.releaseBeforeSend(claimed.lease.executionId, claimed.lease.leaseVersion)
    return { requested: false, unknown: false, verified: false, blockers: [ready.reason], audit: audit({ ...base, executionId: claimed.lease.executionId, errorCode: ready.reason }) }
  }
  const sent = await input.authority.markSent(ready.lease.executionId, ready.lease.leaseVersion, input.stage)
  if (!sent.ok || !sent.lease || !sent.lease.requestSent || sent.lease.leaseVersion <= ready.lease.leaseVersion) {
    return { requested: false, unknown: false, verified: false, blockers: [sent.reason || '发送标记没有成功。'], audit: audit({ ...base, executionId: claimed.lease.executionId, errorCode: sent.reason || 'mark-sent-failed' }) }
  }
  const marked = await input.checkpoints.markRequestSent(prepared.task, input.itemId, input.stage)
  if (!marked.ok) {
    await input.authority.markUnknown(sent.lease.executionId, sent.lease.leaseVersion)
    return { requested: false, unknown: true, verified: false, blockers: ['检查点没有写入，请求不会发出。'], audit: audit({ ...base, executionId: sent.lease.executionId, result: 'UNKNOWN', errorCode: 'checkpoint-failed' }) }
  }
  try {
    const response = await input.fetchWrite()
    const answered = await input.authority.markResponse(sent.lease.executionId, sent.lease.leaseVersion)
    const read = await input.readback(response.mailId)
    if (!read.matched || !answered.ok || !answered.lease) {
      return {
        requested: true, unknown: false, verified: false, blockers: ['回读不一致。'],
        audit: audit({ ...base, executionId: sent.lease.executionId, requestSent: true, responseReceived: true, result: 'READBACK_MISMATCH', errorCode: 'readback-mismatch' })
      }
    }
    const verified = await input.authority.markVerified(answered.lease.executionId, answered.lease.leaseVersion, read.mailId)
    if (verified.ok && verified.lease) await input.authority.complete(verified.lease.executionId, verified.lease.leaseVersion)
    return {
      requested: true, unknown: false, verified: verified.ok, blockers: [],
      audit: audit({ ...base, executionId: sent.lease.executionId, requestSent: true, responseReceived: true, readbackVerified: verified.ok, result: verified.ok ? 'READBACK_VERIFIED' : 'UNVERIFIED', errorCode: '' })
    }
  } catch {
    await input.authority.markUnknown(sent.lease.executionId, sent.lease.leaseVersion)
    return {
      requested: true, unknown: true, verified: false, blockers: ['该操作可能已经在 EASY 成功执行。PatMail 不会自动重试。请执行只读核对。'],
      audit: audit({ ...base, executionId: sent.lease.executionId, requestSent: true, result: 'UNKNOWN', errorCode: 'response-unknown' })
    }
  }
}
