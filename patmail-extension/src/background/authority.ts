import type { LiveAcceptanceRecord } from '../automation/acceptance-runner'
import { evaluateCurrentTaskEvidence, type EvidenceAccount } from '../automation/evidence-evaluation'
import { liveQuerySessions } from '../automation/file-search-snapshot'
import { buildStagePlans } from '../automation/stage-plan'
import { downgradeClientAcceptance, downgradeClientEvidence } from '../automation/acceptance-trust'
import { type EvidenceRepository, type EvidenceSource, type StoredEvidence } from '../automation/evidence-store'
import { ExecutionLedger } from '../automation/ledger'
import { isConfirmedOperator } from '../automation/operator'
import { clientDeclaredExecution } from '../automation/task-transition'
import { clientTaskRejection } from '../automation/task-trust'
import type { TaskStore } from '../automation/task-service'
import type { AutomationTask } from '../automation/types'
import { MessageType, type AppMessage, type BackgroundResponse, type TaskSummary } from '../shared/message'

export interface AuthorityDeps {
  ledger: ExecutionLedger | null
  tasks: TaskStore | null
  evidence: EvidenceRepository
  account?: EvidenceAccount | null
}

function summary(task: AutomationTask): TaskSummary {
  return {
    taskId: task.taskId,
    createdAt: task.createdAt,
    customerName: task.customerName,
    fileCount: task.selectedFiles.length,
    mailCount: task.items.length,
    status: task.status,
    verifiedAt: task.verifiedAt,
    updatedAt: task.updatedAt
  }
}

function leasePayload(result: { ok: boolean; reason: string; lease: { executionId: string; taskFingerprint: string; owner: string; status: string; requestSent: boolean; easyMailId: string } | null }): BackgroundResponse {
  return { type: MessageType.ExecutionLease, payload: { ok: result.ok, reason: result.reason, lease: result.lease } }
}

function denied(reason: string): BackgroundResponse {
  return { type: MessageType.ExecutionLease, payload: { ok: false, reason, lease: null } }
}

/** Background 是租约和任务库的唯一写入方。 */
export async function handleAuthorityMessage(message: AppMessage, deps: AuthorityDeps): Promise<BackgroundResponse | null> {
  if (message.type === MessageType.ClaimExecution) {
    if (!deps.ledger) return denied('执行记录存储不可用，不能领取。')
    if (!isConfirmedOperator(message.payload.operatorId)) return denied('当前 EASY 用户身份尚未确认。')
    const result = await deps.ledger.claim(message.payload.origin, message.payload.operatorId, message.payload.taskFingerprint)
    return leasePayload({ ok: result.ok, reason: result.ok ? '' : result.reason, lease: result.lease })
  }
  if (message.type === MessageType.RecoverExecution) {
    if (!deps.ledger || !isConfirmedOperator(message.payload.operatorId)) {
      return { type: MessageType.ExecutionRecovered, payload: { leases: [] } }
    }
    const leases = await deps.ledger.recover(message.payload.origin, message.payload.operatorId)
    return { type: MessageType.ExecutionRecovered, payload: { leases } }
  }
  if (!deps.ledger) return denied('执行记录存储不可用，不能领取。')
  if (message.type === MessageType.MarkExecutionPrepared || message.type === MessageType.MarkExecutionSent ||
    message.type === MessageType.MarkExecutionResponse || message.type === MessageType.MarkExecutionVerified ||
    message.type === MessageType.CompleteExecution || message.type === MessageType.ReleaseExecution ||
    message.type === MessageType.MarkExecutionUnknown) {
    if (!isConfirmedOperator(message.payload.operatorId)) return denied('当前 EASY 用户身份尚未确认。')
    const command = message.payload
    const result = message.type === MessageType.MarkExecutionPrepared ? await deps.ledger.markPrepared(command.executionId, command.leaseVersion)
      : message.type === MessageType.MarkExecutionSent ? await deps.ledger.markSent(command.executionId, command.leaseVersion, 'sent')
      : message.type === MessageType.MarkExecutionResponse ? await deps.ledger.markResponse(command.executionId, command.leaseVersion)
      : message.type === MessageType.MarkExecutionVerified ? await deps.ledger.markVerified(command.executionId, command.leaseVersion)
      : message.type === MessageType.CompleteExecution ? await deps.ledger.complete(command.executionId, command.leaseVersion)
      : message.type === MessageType.ReleaseExecution ? await deps.ledger.releaseBeforeSend(command.executionId, command.leaseVersion)
      : await deps.ledger.markUnknown(command.executionId, command.leaseVersion)
    return leasePayload(result)
  }
  if (!deps.tasks) return { type: MessageType.TaskResult, payload: { ok: false, message: '任务存储不可用。', tasks: [], task: null } }
  if (message.type === MessageType.ListTasks) {
    if (!isConfirmedOperator(message.payload.operatorId)) {
      return { type: MessageType.TaskResult, payload: { ok: false, message: '当前 EASY 用户身份尚未确认。', tasks: [], task: null } }
    }
    const tasks = await deps.tasks.list(message.payload.origin, message.payload.operatorId, false)
    return { type: MessageType.TaskResult, payload: { ok: true, message: '', tasks: tasks.map(summary), task: null } }
  }
  if (message.type === MessageType.GetTask || message.type === MessageType.ArchiveTask || message.type === MessageType.ValidateTaskMetadata) {
    if (!isConfirmedOperator(message.payload.operatorId)) {
      return { type: MessageType.TaskResult, payload: { ok: false, message: '当前 EASY 用户身份尚未确认。', tasks: [], task: null } }
    }
    if (message.type === MessageType.ArchiveTask) {
      const archived = await deps.tasks.archive(message.payload.origin, message.payload.operatorId, message.payload.taskId)
      return { type: MessageType.TaskResult, payload: { ok: archived.ok, message: archived.message, tasks: [], task: null } }
    }
    const tasks = await deps.tasks.list(message.payload.origin, message.payload.operatorId, true)
    const task = tasks.find(item => item.taskId === message.payload.taskId) ?? null
    if (message.type === MessageType.ValidateTaskMetadata) {
      return { type: MessageType.TaskResult, payload: { ok: Boolean(task), message: task ? '' : '没有这个任务。', tasks: [], task: null } }
    }
    if (!task) return { type: MessageType.TaskResult, payload: { ok: false, message: '没有这个任务。', tasks: [], task: null } }
    const bound = deps.account && deps.account.easyOrigin === task.origin && deps.account.operatorId === task.operatorId
      ? deps.account
      : { easyOrigin: task.origin, operatorId: task.operatorId }
    const now = new Date().toISOString()
    const currentEvidence = await evaluateCurrentTaskEvidence(task, bound, liveQuerySessions(), now)
    const stagePlans = buildStagePlans(task, 'UNKNOWN', { now, currentAccount: bound, currentEvidenceState: currentEvidence })
    return {
      type: MessageType.TaskResult,
      payload: {
        ok: true,
        message: '',
        tasks: [],
        task: task as unknown as Record<string, unknown>,
        currentEvidence: currentEvidence as unknown as Record<string, unknown>,
        stagePlans: stagePlans as unknown as Record<string, unknown>[]
      }
    }
  }
  if (message.type === MessageType.SaveTask) {
    const task = message.payload.task as unknown as AutomationTask
    if (!isConfirmedOperator(task.operatorId)) {
      return { type: MessageType.TaskResult, payload: { ok: false, message: '当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。', tasks: [], task: null } }
    }
    const rejection = clientTaskRejection(task)
    if (rejection) return { type: MessageType.TaskResult, payload: { ok: false, message: rejection, tasks: [], task: null } }
    const declared = clientDeclaredExecution(task)
    if (declared) return { type: MessageType.TaskResult, payload: { ok: false, message: declared, tasks: [], task: null } }
    return { type: MessageType.TaskResult, payload: { ok: false, message: '正式页面不能提交完整任务。', tasks: [], task: null } }
  }
  if (message.type === MessageType.SaveAcceptance) {
    const raw = message.payload.record as unknown as LiveAcceptanceRecord
    if (typeof raw.call !== 'string' || (raw.result !== 'PASS' && raw.result !== 'FAIL' && raw.result !== 'BLOCKED')) {
      return { type: MessageType.AcceptanceResult, payload: { records: [] } }
    }
    await deps.evidence.saveAcceptance(downgradeClientAcceptance(raw))
    return { type: MessageType.AcceptanceResult, payload: { records: [] } }
  }
  if (message.type === MessageType.ListAcceptance) {
    if (!isConfirmedOperator(message.payload.operatorId)) return { type: MessageType.AcceptanceResult, payload: { records: [] } }
    const records = await deps.evidence.listAcceptance(message.payload.origin, message.payload.operatorId)
    return { type: MessageType.AcceptanceResult, payload: { records: records as unknown as Record<string, unknown>[] } }
  }
  if (message.type === MessageType.SaveEvidence) {
    const raw = clientEvidence(message.payload.record)
    if (!raw) return { type: MessageType.EvidenceResult, payload: { records: [] } }
    await deps.evidence.saveEvidence(downgradeClientEvidence(raw))
    return { type: MessageType.EvidenceResult, payload: { records: [] } }
  }
  if (message.type === MessageType.ListEvidence) {
    const records = await deps.evidence.listEvidence(message.payload.origin, message.payload.call)
    return { type: MessageType.EvidenceResult, payload: { records: records as unknown as Record<string, unknown>[] } }
  }
  return null
}

function clientEvidence(value: Record<string, unknown>): StoredEvidence | null {
  if (typeof value.call !== 'string' || typeof value.origin !== 'string' || typeof value.handler !== 'string') return null
  if (typeof value.httpStatus !== 'number' || typeof value.requestShape !== 'string' || typeof value.responseShape !== 'string') return null
  if (typeof value.capturedAt !== 'string') return null
  const source: EvidenceSource = value.source === 'CAPTURED_HAR' || value.source === 'MOCK' || value.source === 'LIVE' || value.source === 'PAGE_SCRIPT' ? value.source : 'PAGE_SCRIPT'
  return {
    evidenceId: typeof value.evidenceId === 'string' ? value.evidenceId : '',
    handler: value.handler,
    call: value.call,
    origin: value.origin,
    operatorIdHash: '',
    requestShape: value.requestShape,
    responseShape: value.responseShape,
    httpStatus: value.httpStatus,
    businessSuccess: false,
    readbackCall: typeof value.readbackCall === 'string' ? value.readbackCall : '',
    readbackMatched: false,
    source,
    level: 'UNKNOWN',
    capturedAt: value.capturedAt,
    verifiedAt: '',
    sampleHash: ''
  }
}
