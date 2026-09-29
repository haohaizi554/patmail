import { isQueryGuid } from '../query/query-validator'
import { isAuditType, nextFlowStatus } from './contracts'
import type { AuditType, EasyWorkflowSnapshot, WorkflowNode, WorkflowReviewer } from './types'

export interface MockPageFields {
  score: string
  finishDate: string
  picUser: string
  intDueDate: string
  cusDueDate: string
  legDueDate: string
  source: 'mock-page'
}

export interface SubmitBuildInput {
  snapshot: EasyWorkflowSnapshot
  node: WorkflowNode
  reviewer: WorkflowReviewer
  auditType: AuditType
  remark: string
  urgencyId: string
  /** 页面脚本列出了这些字段，但抓包没有留下值。只有 Mock 明确提供时才写入。 */
  pageFields: MockPageFields | null
}

/** mail.js 结束流程时写死的下一节点。 */
export const END_FLOW_NODE_ID = '5A0F9ABF-0816-4FBB-A682-212FDDBE5224'

export interface EndFlowInput {
  mailId: string
  status: number | null
  flowId: string
  flowType: string
  flowSubType: string | null
  currentNodeId: string | null
  currentNodeCode: string | null
}

/** 按 Mail.EndFlow 组 EndEmailFlowd。回调不读响应，调用仍受流程写门禁约束。 */
export function buildEndEmailFlow(input?: EndFlowInput | null): { params: URLSearchParams | null; blockers: string[] } {
  if (!input) return { params: null, blockers: ['结束流程还没有当前流程信息。'] }
  const blockers: string[] = []
  if (!isQueryGuid(input.mailId)) blockers.push('f_obj_id 没有已确认的邮件 ID。')
  if (input.status === null) blockers.push('f_cur_status 在当前流程响应里缺失。')
  if (!isQueryGuid(input.flowId)) blockers.push('f_flow_id 没有来自当前流程。')
  if (!input.flowType.trim()) blockers.push('f_flow_type 没有来自当前流程。')
  if (input.flowSubType === null) blockers.push('f_flow_sub_type 在当前流程响应里缺失。')
  if (!isQueryGuid(input.currentNodeId ?? '')) blockers.push('f_cur_node_id 在当前流程响应里缺失。')
  if (!input.currentNodeCode?.trim()) blockers.push('f_cur_node_code 在当前流程响应里缺失。')
  if (blockers.length > 0) return { params: null, blockers }
  const params = new URLSearchParams()
  params.set('Call', 'EndEmailFlowd')
  params.set('f_obj_id', input.mailId)
  params.set('f_cur_status', String(input.status))
  params.set('f_status', '5000')
  params.set('f_allow_edit', '0')
  params.set('f_flow_id', input.flowId)
  params.set('f_flow_type', input.flowType)
  params.set('f_flow_sub_type', input.flowSubType ?? '')
  params.set('f_cur_node_id', input.currentNodeId ?? '')
  params.set('f_cur_node_code', input.currentNodeCode ?? '')
  params.set('f_next_node_id', END_FLOW_NODE_ID)
  params.set('f_next_node_code', 'END')
  params.set('f_audit_type_id', 'submit')
  return { params, blockers }
}

export function buildFlowSubmit(input: SubmitBuildInput): { params: URLSearchParams | null; blockers: string[] } {
  const blockers: string[] = []
  const { snapshot, node, reviewer } = input
  const status = nextFlowStatus(node.nodeCode)
  if (!isQueryGuid(snapshot.mailId)) blockers.push('f_obj_id 没有已确认的邮件 ID。')
  if (!isQueryGuid(snapshot.flowId)) blockers.push('f_flow_id 没有来自当前流程。')
  if (!snapshot.flowType.trim()) blockers.push('f_flow_type 没有来自当前流程。')
  if (snapshot.flowSubType === null) blockers.push('f_flow_sub_type 在当前流程响应里缺失。')
  if (snapshot.status === null) blockers.push('f_cur_status 在当前流程响应里缺失。')
  if (snapshot.currentNodeId === null || snapshot.currentNodeCode === null || snapshot.currentNodeName === null) {
    blockers.push('当前节点字段在流程响应里缺失。')
  }
  if (snapshot.allowEdit === null) blockers.push('f_allow_edit 没有来自当前活动节点。')
  if (!status) blockers.push('下一节点状态无法按节点代码计算。')
  if (!isQueryGuid(node.nodeId)) blockers.push('下一节点 ID 无效。')
  if (!node.nodeCode.trim()) blockers.push('下一节点代码缺失。')
  if (!isQueryGuid(reviewer.id)) blockers.push('下一办理人 ID 无效。')
  if (node.parallel === null) blockers.push('f_is_parallel 在下一节点响应里缺失。')
  if (!isAuditType(input.auditType)) blockers.push('f_audit_type_id 只能是 submit 或 handover。')
  if (!input.urgencyId.trim()) blockers.push('f_urgency_id 还没有选择。')
  if (node.parallel === true) blockers.push('该节点是并行审核，提交格式还没有核对。')
  if (node.needAllAudit === true) blockers.push('该节点需要全部审核，不能只提交一名办理人。')
  if (!input.pageFields || input.pageFields.source !== 'mock-page') {
    blockers.push('f_score、finishdate、pic_user 和期限字段没有已核对的值，不能填空。')
  }
  if (blockers.length > 0) return { params: null, blockers }
  const params = new URLSearchParams()
  params.set('Call', 'FlowSubmit')
  params.set('f_audit_type_id', input.auditType)
  params.set('f_obj_id', snapshot.mailId)
  params.set('f_cur_status', String(snapshot.status))
  params.set('f_status', status ?? '')
  params.set('f_allow_edit', snapshot.allowEdit ? '1' : '0')
  params.set('f_flow_id', snapshot.flowId)
  params.set('f_flow_type', snapshot.flowType)
  params.set('f_flow_sub_type', snapshot.flowSubType ?? '')
  params.set('f_cur_node_id', snapshot.currentNodeId ?? '')
  params.set('f_cur_node_code', snapshot.currentNodeCode ?? '')
  params.set('f_cur_node', snapshot.currentNodeName ?? '')
  params.set('f_next_node_id', node.nodeId)
  params.set('f_next_node_code', node.nodeCode)
  params.set('f_next_user_id', reviewer.id)
  params.set('f_next_user_name', reviewer.name)
  params.set('f_list_id', node.listId)
  params.set('f_remark', input.remark)
  params.set('f_is_parallel', node.parallel ? '1' : '0')
  params.set('f_urgency_id', input.urgencyId)
  params.set('f_score', input.pageFields?.score ?? '')
  params.set('finishdate', input.pageFields?.finishDate ?? '')
  params.set('pic_user', input.pageFields?.picUser ?? '')
  params.set('int_due_date', input.pageFields?.intDueDate ?? '')
  params.set('cus_due_date', input.pageFields?.cusDueDate ?? '')
  params.set('leg_due_date', input.pageFields?.legDueDate ?? '')
  return { params, blockers }
}
