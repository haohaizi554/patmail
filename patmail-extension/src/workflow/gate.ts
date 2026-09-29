import { isWriteSwitchOpen } from '../settings/write-switch'

/** 跟系统设置里的写开关走。默认打开。 */
export function workflowWritesEnabled(): boolean {
  return isWriteSwitchOpen()
}

export const WORKFLOW_CONTRACT = {
  getFlowSubmitBodyCaptured: false,
  flowSubmitBodyCaptured: false,
  endFlowBodyCaptured: false,
  crossTabCreateAtomic: false
} as const

export interface WorkflowWriteGate {
  blockers(): string[]
}

export function liveWorkflowBlockers(): string[] {
  const reasons: string[] = []
  if (!workflowWritesEnabled()) reasons.push('写开关已关闭。')
  if (!WORKFLOW_CONTRACT.getFlowSubmitBodyCaptured) reasons.push('GetFlowSubmit 的响应正文还没有核对。')
  if (!WORKFLOW_CONTRACT.flowSubmitBodyCaptured) reasons.push('FlowSubmit 的响应正文还没有核对。')
  if (!WORKFLOW_CONTRACT.endFlowBodyCaptured) reasons.push('EndEmailFlowd 的响应正文还没有核对。')
  if (!WORKFLOW_CONTRACT.crossTabCreateAtomic) reasons.push('跨标签页的执行记录不是原子写入，真实写操作保持关闭。')
  return reasons
}

export const productionWorkflowGate: WorkflowWriteGate = { blockers: liveWorkflowBlockers }
