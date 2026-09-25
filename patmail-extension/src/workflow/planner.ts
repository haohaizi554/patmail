import { isQueryGuid } from '../query/query-validator'
import { resolveNextNodes } from './node-resolver'
import { resolveReviewer } from './reviewer-resolver'
import { buildFlowSubmit, type MockPageFields } from './submit-builder'
import type { AuditType, EasyWorkflowSnapshot, WorkflowPlan } from './types'

export interface PlanInput {
  currentUserId: string
  nodeId: string
  reviewerId: string
  auditType: AuditType
  remark: string
  urgencyId: string
  pageFields: MockPageFields | null
}

export function planWorkflow(snapshot: EasyWorkflowSnapshot, input: PlanInput): { plan: WorkflowPlan | null; blockers: string[] } {
  const nodes = resolveNextNodes(snapshot.availableNodes, input.nodeId)
  if (nodes.kind === 'none') return { plan: null, blockers: ['没有可选的下一节点。'] }
  if (nodes.kind === 'many') return { plan: null, blockers: ['下一节点不唯一，需要先选择节点。'] }
  if (nodes.kind === 'missing') return { plan: null, blockers: ['选择的节点不在当前候选列表里。'] }
  const reviewer = resolveReviewer(input.currentUserId, nodes.node, input.reviewerId)
  if (reviewer.status === 'blocked') return { plan: null, blockers: [reviewer.reason] }
  const urgencyKnown = snapshot.urgencies.some(item => item.id.toLowerCase() === input.urgencyId.toLowerCase())
  const blockers = urgencyKnown ? [] : ['缓急不在本次读取的列表中。']
  const built = blockers.length > 0 ? { params: null, blockers } : buildFlowSubmit({
    snapshot, node: nodes.node, reviewer: reviewer.reviewer, auditType: input.auditType,
    remark: input.remark, urgencyId: input.urgencyId, pageFields: input.pageFields
  })
  const params = built.params ? Object.fromEntries(built.params.entries()) : null
  if (params && !isQueryGuid(String(params.f_obj_id)) ) built.blockers.push('f_obj_id 无效。')
  return {
    plan: {
      mailId: snapshot.mailId, flowId: snapshot.flowId, auditType: input.auditType, node: nodes.node,
      reviewer: reviewer.reviewer, self: reviewer.reviewer.id.toLowerCase() === input.currentUserId.toLowerCase(),
      urgencyId: input.urgencyId, remark: input.remark, versionToken: snapshot.versionToken,
      params, blockers: built.blockers
    },
    blockers: built.blockers
  }
}
