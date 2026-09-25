import type { AutomationTask, Checkpoint, StageId } from './types'
import { STAGES } from './state'

export function appendCheckpoint(task: AutomationTask, stage: StageId, note: string, requestSent = false, itemId = ''): AutomationTask {
  const checkpoint: Checkpoint = {
    stage, itemId, requestSent, responseReceived: false, verified: false, easyMailId: '', at: new Date().toISOString(), note
  }
  return { ...task, checkpoints: [...task.checkpoints, checkpoint], updatedAt: checkpoint.at, status: requestSent ? 'RUNNING' : task.status }
}

/** 写请求发出前先落盘。未知结果不能自动再发同一种写请求。 */
export function markRequestSent(task: AutomationTask, stage: StageId, itemId = ''): AutomationTask {
  const definition = STAGES[stage]
  if (definition.sideEffect !== 'write') return appendCheckpoint(task, stage, '这个阶段没有写请求。', false, itemId)
  return { ...appendCheckpoint(task, stage, '请求即将发出。', true, itemId), status: 'RUNNING' }
}

export function markUnknown(task: AutomationTask, stage: StageId, itemId = ''): AutomationTask {
  return { ...appendCheckpoint(task, stage, '请求已经发出，但没有确定响应。', true, itemId), status: 'UNKNOWN', readonly: true }
}
