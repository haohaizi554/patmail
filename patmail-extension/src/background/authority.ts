import type { LiveAcceptanceRecord } from '../automation/acceptance-runner'
import { type EvidenceRepository, type StoredEvidence } from '../automation/evidence-store'
import { ExecutionLedger } from '../automation/ledger'
import { isConfirmedOperator } from '../automation/operator'
import type { TaskStore } from '../automation/task-service'
import type { AutomationTask } from '../automation/types'
import { MessageType, type AppMessage, type BackgroundResponse, type TaskSummary } from '../shared/message'

export interface AuthorityDeps {
  ledger: ExecutionLedger | null
  tasks: TaskStore | null
  evidence: EvidenceRepository
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
    return { type: MessageType.TaskResult, payload: { ok: Boolean(task), message: task ? '' : '没有这个任务。', tasks: [], task: task as unknown as Record<string, unknown> | null } }
  }
  if (message.type === MessageType.SaveTask) {
    const task = message.payload.task as unknown as AutomationTask
    if (!isConfirmedOperator(task.operatorId)) {
      return { type: MessageType.TaskResult, payload: { ok: false, message: '当前 EASY 用户身份尚未确认。计划不会持久化，也不能执行。', tasks: [], task: null } }
    }
    await deps.tasks.save(task)
    return { type: MessageType.TaskResult, payload: { ok: true, message: '', tasks: [], task: null } }
  }
  if (message.type === MessageType.SaveAcceptance) {
    await deps.evidence.saveAcceptance(message.payload.record as unknown as LiveAcceptanceRecord)
    return { type: MessageType.AcceptanceResult, payload: { records: [] } }
  }
  if (message.type === MessageType.ListAcceptance) {
    if (!isConfirmedOperator(message.payload.operatorId)) return { type: MessageType.AcceptanceResult, payload: { records: [] } }
    const records = await deps.evidence.listAcceptance(message.payload.origin, message.payload.operatorId)
    return { type: MessageType.AcceptanceResult, payload: { records: records as unknown as Record<string, unknown>[] } }
  }
  if (message.type === MessageType.SaveEvidence) {
    await deps.evidence.saveEvidence(message.payload.record as unknown as StoredEvidence)
    return { type: MessageType.EvidenceResult, payload: { records: [] } }
  }
  if (message.type === MessageType.ListEvidence) {
    const records = await deps.evidence.listEvidence(message.payload.origin, message.payload.call)
    return { type: MessageType.EvidenceResult, payload: { records: records as unknown as Record<string, unknown>[] } }
  }
  return null
}
