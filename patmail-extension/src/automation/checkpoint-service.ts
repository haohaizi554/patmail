import { appendCheckpoint, markRequestSent, markUnknown } from './checkpoint'
import { STAGES } from './state'
import type { AutomationTask, StageId } from './types'

export interface CheckpointSink {
  save(task: AutomationTask): Promise<void>
}

/** 落盘失败时返回原任务，调用方不得发出写请求。 */
export class CheckpointService {
  constructor(private readonly sink: CheckpointSink) {}

  prepare(task: AutomationTask, itemId: string, stage: StageId): Promise<{ ok: boolean; task: AutomationTask; reason: string }> {
    if (STAGES[stage].sideEffect !== 'write') return Promise.resolve({ ok: true, task, reason: '这个阶段没有写请求。' })
    return this.persist(task, appendCheckpoint(task, stage, 'PREPARED', false, itemId))
  }

  markRequestSent(task: AutomationTask, itemId: string, stage: StageId): Promise<{ ok: boolean; task: AutomationTask; reason: string }> {
    if (STAGES[stage].sideEffect !== 'write') return Promise.resolve({ ok: true, task, reason: '这个阶段没有写请求。' })
    return this.persist(task, markRequestSent(task, stage, itemId))
  }

  markResponseReceived(task: AutomationTask, itemId: string, stage: StageId): Promise<{ ok: boolean; task: AutomationTask; reason: string }> {
    const next = patch(task, itemId, stage, item => ({ ...item, responseReceived: true, note: '已收到响应。' }))
    return this.persist(task, next)
  }

  markVerified(task: AutomationTask, itemId: string, stage: StageId, easyMailId = ''): Promise<{ ok: boolean; task: AutomationTask; reason: string }> {
    const next = patch(task, itemId, stage, item => ({ ...item, verified: true, easyMailId: easyMailId || item.easyMailId, note: '已回读核验。' }))
    return this.persist(task, { ...next, verifiedAt: new Date().toISOString() })
  }

  markUnknown(task: AutomationTask, itemId: string, stage: StageId): Promise<{ ok: boolean; task: AutomationTask; reason: string }> {
    return this.persist(task, markUnknown(task, stage, itemId))
  }

  private persist(previous: AutomationTask, next: AutomationTask): Promise<{ ok: boolean; task: AutomationTask; reason: string }> {
    return this.sink.save(next).then(
      () => ({ ok: true, task: next, reason: '' }),
      () => ({ ok: false, task: previous, reason: '检查点没有写入，请求不会发出。' })
    )
  }
}

function patch(task: AutomationTask, itemId: string, stage: StageId, map: (item: AutomationTask['checkpoints'][number]) => AutomationTask['checkpoints'][number]): AutomationTask {
  return { ...task, checkpoints: task.checkpoints.map(item => item.itemId === itemId && item.stage === stage ? map(item) : item) }
}
