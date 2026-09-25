/** 真实流程提交默认关闭。页面消息不能打开它。 */
export const WORKFLOW_WRITES_ENABLED = false

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
  if (!WORKFLOW_WRITES_ENABLED) reasons.push('真实流程提交默认关闭。')
  if (!WORKFLOW_CONTRACT.getFlowSubmitBodyCaptured) reasons.push('GetFlowSubmit 的响应正文还没有核对。')
  if (!WORKFLOW_CONTRACT.flowSubmitBodyCaptured) reasons.push('FlowSubmit 的响应正文还没有核对。')
  if (!WORKFLOW_CONTRACT.endFlowBodyCaptured) reasons.push('EndEmailFlowd 的响应正文还没有核对。')
  if (!WORKFLOW_CONTRACT.crossTabCreateAtomic) reasons.push('跨标签页的执行记录不是原子写入，真实写操作保持关闭。')
  return reasons
}

export const productionWorkflowGate: WorkflowWriteGate = { blockers: liveWorkflowBlockers }
