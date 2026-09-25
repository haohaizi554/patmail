import type { EasyTransport } from '../api/transport'
import { isQueryGuid } from '../query/query-validator'
import { versionAgrees } from './contracts'
import type { WorkflowWriteGate } from './gate'
import { planWorkflow, type PlanInput } from './planner'
import { WorkflowReadService, type WorkflowRead } from './read-service'
import { applyWorkflowEvent, blocksAnotherSubmit } from './state'
import { WorkflowStore } from './store'
import type { FlowInfoFields } from './contracts'
import type { WorkflowExecutionEvent, WorkflowExecutionRecord, WorkflowExecutionState, WorkflowPlan, WorkflowView } from './types'

export interface MockSubmitResult { status: 'accepted' | 'rejected' | 'unknown' }

export interface WorkflowRuntimeOptions {
  /** 只在测试里传入。生产 EasyRuntime 不提供这个回调，因此不会提交。 */
  mockSubmit?: (params: Record<string, string>) => Promise<MockSubmitResult>
}

function now(): string {
  return new Date().toISOString()
}

interface Detail {
  read: WorkflowRead | null
  plan: WorkflowPlan | null
}

export class WorkflowRuntime {
  private readonly reader: WorkflowReadService
  private readonly details = new Map<string, Detail>()

  constructor(
    transport: EasyTransport,
    private readonly store: WorkflowStore,
    private readonly gate: WorkflowWriteGate,
    private readonly origin: string,
    private readonly mailVerified: (userId: string, mailId: string) => Promise<boolean>,
    private readonly options: WorkflowRuntimeOptions = {}
  ) {
    this.reader = new WorkflowReadService(transport)
  }

  async read(userId: string, mailId: string, flowType: string): Promise<WorkflowView> {
    if (!isQueryGuid(mailId) || !flowType.trim()) return this.ephemeral(userId, mailId, '当前邮件或流程类型无效。')
    if (!(await this.mailVerified(userId, mailId))) return this.ephemeral(userId, mailId, '文件关联还没有核验，不能进入流程。')
    return this.store.exclusive(this.origin, userId, mailId, async () => {
      const records = await this.store.load(this.origin, userId)
      const held = records.find(item => item.mailId.toLowerCase() === mailId.toLowerCase() && item.status === 'UNKNOWN')
      if (held) return this.rereadUnknown(userId, records, held, flowType)
      const blocking = records.find(item => item.mailId.toLowerCase() === mailId.toLowerCase() && blocksAnotherSubmit(item))
      if (blocking) return this.view(blocking, ['已有未结束的流程提交，不能另起一次。'])
      let record = this.blank(userId, mailId)
      record = this.move(record, 'READ_STARTED') ?? record
      await this.persist(userId, records, record)
      const loaded = await this.reader.load(mailId, flowType)
      if (!loaded.ok) {
        record = this.move(record, 'READ_FAILED', { lastError: loaded.message }) ?? record
        await this.persist(userId, records, record)
        return this.view(record, [loaded.message])
      }
      record = this.move(record, 'READ_READY', {
        flowId: loaded.data.info.flowId,
        currentNodeId: loaded.data.info.curNodeId ?? '',
        versionToken: loaded.data.snapshot.versionToken ?? '',
        lastError: ''
      }) ?? record
      this.details.set(record.executionId, { read: loaded.data, plan: null })
      if (!loaded.data.info.flowId) {
        record = this.move(record, 'READ_FAILED', { lastError: '当前邮件没有流程。' }) ?? record
        await this.persist(userId, records, record)
        return this.view(record, ['当前邮件没有流程。'])
      }
      await this.persist(userId, records, record)
      const blockers = loaded.data.nodeMessage ? [loaded.data.nodeMessage] : []
      return this.view(record, blockers)
    })
  }

  async refresh(userId: string, executionId: string): Promise<WorkflowView> {
    const records = await this.store.load(this.origin, userId)
    const current = records.find(item => item.executionId === executionId && item.userId === userId)
    if (!current) return this.ephemeral(userId, '', '没有可刷新的流程记录。')
    const detail = this.details.get(executionId)
    if (!detail?.read) return this.view(current, ['请先读取流程。'])
    const nodes = await this.reader.nodes(detail.read.info)
    detail.read.snapshot = { ...detail.read.snapshot, availableNodes: nodes.nodes }
    detail.read.nodeMessage = nodes.message
    detail.plan = null
    return this.view(current, nodes.message ? [nodes.message] : [])
  }

  async preview(userId: string, executionId: string, input: PlanInput): Promise<WorkflowView> {
    const records = await this.store.load(this.origin, userId)
    const current = records.find(item => item.executionId === executionId && item.userId === userId)
    if (!current) return this.ephemeral(userId, '', '没有可预览的流程记录。')
    if (current.requestSent || current.status === 'UNKNOWN') return this.view(current, ['提交流程的结果还不能确认，不能用旧计划重试。'])
    const detail = this.details.get(executionId)
    if (!detail?.read) return this.view(current, ['请先读取流程。'])
    const planned = planWorkflow(detail.read.snapshot, { ...input, currentUserId: userId })
    detail.plan = planned.plan
    let record = current
    const reason = planned.blockers.join('')
    if (!planned.plan && planned.blockers.some(item => item.includes('不唯一'))) {
      record = this.move(record, 'NEED_NODE', { lastError: reason }) ?? { ...record, lastError: reason }
    } else if (!planned.plan && planned.blockers.some(item => item.includes('同名'))) {
      record = this.move(record, 'NEED_REVIEWER', { lastError: reason }) ?? { ...record, lastError: reason }
    } else if (!planned.plan) {
      record = this.move(record, 'READ_FAILED', { lastError: reason }) ?? { ...record, lastError: reason }
    } else if (planned.plan.params && planned.plan.blockers.length === 0) {
      record = this.move(record, 'PLAN_READY', {
        nextNodeId: planned.plan.node.nodeId, reviewerId: planned.plan.reviewer.id, lastError: ''
      }) ?? record
      record = this.move(record, 'REQUEST_CONFIRM') ?? record
    } else {
      record = this.move(record, 'PLAN_READY', {
        nextNodeId: planned.plan.node.nodeId, reviewerId: planned.plan.reviewer.id, lastError: reason
      }) ?? { ...record, lastError: reason }
    }
    await this.persist(userId, records, record)
    return this.view(record, planned.blockers)
  }

  async submit(userId: string, executionId: string, confirmed: true): Promise<WorkflowView> {
    const current = (await this.store.load(this.origin, userId)).find(item => item.executionId === executionId)
    if (!current) return this.ephemeral(userId, '', '没有可提交的流程记录。')
    return this.store.exclusive(this.origin, userId, current.mailId, () => this.submitLocked(userId, executionId, confirmed))
  }

  private async submitLocked(userId: string, executionId: string, confirmed: true): Promise<WorkflowView> {
    const records = await this.store.load(this.origin, userId)
    let record = records.find(item => item.executionId === executionId && item.userId === userId && item.origin === this.origin)
    if (!record) return this.ephemeral(userId, '', '没有可提交的流程记录。')
    if (record.requestSent || record.status === 'UNKNOWN') return this.view(record, ['提交流程的结果还不能确认，不能自动重试。'])
    const detail = this.details.get(executionId)
    const plan = detail?.plan
    const mockSubmit = this.options.mockSubmit
    const gateReasons = this.gate.blockers()
    if (!confirmed || !plan?.params || plan.blockers.length > 0 || gateReasons.length > 0 || !mockSubmit || !detail?.read) {
      const reason = !mockSubmit ? '真实提交流程尚未开放。' : gateReasons[0] ?? plan?.blockers[0] ?? '真实提交流程尚未开放。'
      record = this.move(record, 'READ_FAILED', { lastError: reason }) ?? { ...record, lastError: reason }
      await this.persist(userId, records, record)
      return this.view(record, [reason])
    }
    if (!(await this.mailVerified(userId, record.mailId))) {
      record = this.move(record, 'READ_FAILED', { lastError: '文件关联还没有核验，不能提交流程。' }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, ['文件关联还没有核验，不能提交流程。'])
    }
    const checking = this.move(record, 'CONFIRM_SUBMIT')
    if (!checking) return this.view(record, ['当前阶段不能提交。'])
    record = checking
    await this.persist(userId, records, record)
    const fresh = await this.reader.reloadInfo(record.mailId, detail.read.info.flowType)
    if (!fresh.ok) {
      record = this.move(record, 'VERSION_UNKNOWN', { lastError: fresh.message }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [record.lastError])
    }
    const last = await this.reader.lastStatus(record.mailId, fresh.info.flowType)
    if (!last.ok) {
      record = this.move(record, 'VERSION_UNKNOWN', { lastError: last.message }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [record.lastError])
    }
    const freshToken = fresh.info.updateTimeSs?.trim() ? fresh.info.updateTimeSs : ''
    const agreement = versionAgrees(fresh.info.status, freshToken || null, last.present, last.token)
    if (agreement === 'stale' || freshToken !== record.versionToken || (fresh.info.curNodeId ?? '') !== record.currentNodeId) {
      detail.plan = null
      record = this.move(record, 'VERSION_STALE', {
        currentNodeId: fresh.info.curNodeId ?? '',
        versionToken: freshToken,
        nextNodeId: '',
        reviewerId: '',
        lastError: '流程已被更新，旧的下一节点和审核人已作废。'
      }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, ['流程已被更新，旧的下一节点和审核人已作废。'])
    }
    if (agreement === 'unknown') {
      record = this.move(record, 'VERSION_UNKNOWN', { lastError: '流程版本无法比较，已停止。' }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, ['流程版本无法比较，已停止。'])
    }
    const submitting = this.move(record, 'VERSION_MATCH', { requestSent: true, submittedAt: now(), lastError: '' })
    if (!submitting) return this.view(record, ['当前阶段不能提交。'])
    record = submitting
    await this.persist(userId, records, record)
    let outcome: MockSubmitResult
    try {
      outcome = await mockSubmit(plan.params)
    } catch {
      outcome = { status: 'unknown' }
    }
    if (outcome.status === 'accepted') record = this.move(record, 'SUBMIT_ACCEPTED', { lastError: '' }) ?? record
    else if (outcome.status === 'rejected') record = this.move(record, 'SUBMIT_FAILED', { lastError: 'Mock 提交被拒绝。' }) ?? record
    else record = this.move(record, 'SUBMIT_UNKNOWN', { lastError: '提交流程没有确定结果，不能自动重试。' }) ?? record
    await this.persist(userId, records, record)
    if (record.status !== 'SUBMITTED') return this.view(record, [record.lastError])
    record = this.move(record, 'READ_STARTED', { lastVerifiedAt: now() }) ?? record
    await this.persist(userId, records, record)
    const verified = await this.reader.reloadInfo(record.mailId, fresh.info.flowType)
    if (!verified.ok) {
      record = this.move(record, 'VERIFY_FAILED', { lastError: verified.message }) ?? record
      await this.persist(userId, records, record)
      return this.view(record, [verified.message, '这是 Mock 结果，不是 EASY 真实提交。'])
    }
    const changed = (verified.info.curNodeId ?? '') !== record.currentNodeId
    record = this.move(record, changed ? 'VERIFY_OK' : 'VERIFY_FAILED', {
      currentNodeId: verified.info.curNodeId ?? record.currentNodeId,
      lastError: changed ? '' : '重新读取后节点没有变化。',
      lastVerifiedAt: now()
    }) ?? record
    if (detail.read) {
      detail.read.info = verified.info
      detail.read.snapshot = {
        ...detail.read.snapshot,
        currentNodeId: verified.info.curNodeId,
        currentNodeCode: verified.info.nodeCode,
        currentNodeName: verified.info.nodeName,
        versionToken: verified.info.updateTimeSs?.trim() ? verified.info.updateTimeSs : null
      }
    }
    await this.persist(userId, records, record)
    const note = '这是 Mock 结果，不是 EASY 真实提交。'
    return this.view(record, record.lastError ? [record.lastError, note] : [note])
  }

  private async rereadUnknown(userId: string, records: WorkflowExecutionRecord[], record: WorkflowExecutionRecord, flowType: string): Promise<WorkflowView> {
    const loaded = await this.reader.load(record.mailId, flowType)
    if (loaded.ok) this.details.set(record.executionId, { read: loaded.data, plan: null })
    const next = { ...record, lastError: loaded.ok ? '已重新读取流程。提交结果仍未知，没有自动重试。' : loaded.message }
    await this.persist(userId, records, next)
    return this.view(next, [next.lastError])
  }

  private move(record: WorkflowExecutionRecord, event: WorkflowExecutionEvent, patch: Partial<WorkflowExecutionRecord> = {}): WorkflowExecutionRecord | null {
    const next = applyWorkflowEvent(record, event, patch)
    return next.status === record.status ? null : next
  }

  private blank(userId: string, mailId: string): WorkflowExecutionRecord {
    return {
      executionId: globalThis.crypto.randomUUID(), mailId, flowId: '', currentNodeId: '', nextNodeId: '', reviewerId: '',
      status: 'NOT_STARTED', versionToken: '', submittedAt: '', lastVerifiedAt: '', lastError: '', requestSent: false,
      userId, origin: this.origin
    }
  }

  private ephemeral(userId: string, mailId: string, message: string): WorkflowView {
    return this.view({ ...this.blank(userId, mailId), status: 'BLOCKED', lastError: message }, [message])
  }

  private async persist(userId: string, records: WorkflowExecutionRecord[], record: WorkflowExecutionRecord): Promise<void> {
    const next = records.filter(item => item.executionId !== record.executionId).concat(record)
    await this.store.save(this.origin, userId, next)
    const index = records.findIndex(item => item.executionId === record.executionId)
    if (index >= 0) records[index] = record
    else records.push(record)
  }

  private view(record: WorkflowExecutionRecord, blockers: string[] = []): WorkflowView {
    const detail = this.details.get(record.executionId)
    return { record, snapshot: detail?.read?.snapshot ?? null, plan: detail?.plan ?? null, blockers }
  }
}

export type { FlowInfoFields, WorkflowExecutionState }
