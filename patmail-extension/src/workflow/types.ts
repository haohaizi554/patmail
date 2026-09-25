export type WorkflowExecutionState =
  | 'NOT_STARTED' | 'READING' | 'READY' | 'SELECTING_NODE' | 'SELECTING_REVIEWER'
  | 'PREVIEW_READY' | 'CONFIRM_REQUIRED' | 'CHECKING_VERSION' | 'SUBMITTING'
  | 'SUBMITTED' | 'VERIFYING' | 'COMPLETED' | 'STALE' | 'UNKNOWN' | 'FAILED' | 'BLOCKED'

export type WorkflowExecutionEvent =
  | 'READ_STARTED' | 'READ_READY' | 'READ_FAILED' | 'READ_REFRESHED'
  | 'NEED_NODE' | 'NEED_REVIEWER' | 'PLAN_READY' | 'REQUEST_CONFIRM'
  | 'PLAN_INVALIDATED' | 'REPLAN_REQUESTED' | 'PLAN_UPDATED'
  | 'CONFIRM_SUBMIT' | 'VERSION_MATCH' | 'VERSION_STALE' | 'VERSION_UNKNOWN'
  | 'SUBMIT_UNKNOWN' | 'SUBMIT_FAILED' | 'SUBMIT_ACCEPTED'
  | 'VERIFY_OK' | 'VERIFY_FAILED'

export type AuditType = 'submit' | 'handover'

export interface WorkflowReviewer {
  id: string
  name: string
}

export interface WorkflowNode {
  listId: string
  seq: number | null
  next: string
  nodeId: string
  nodeCode: string
  nodeName: string
  allowSkip: boolean | null
  userType: string
  parallel: boolean | null
  needAllAudit: boolean | null
  reviewers: WorkflowReviewer[]
  reviewerFormat: 'structured' | 'single' | 'unknown'
}

export interface WorkflowHistory {
  historyId: string
  nodeId: string
  nodeCode: string
  nodeName: string
  auditUserId: string
  auditUserName: string
  auditType: string
  auditTime: string
  remark: string
}

export interface WorkflowActivity {
  nodeId: string
  nodeCode: string
  nodeName: string
  status: number | null
  auditUserId: string
  auditUserName: string
  allowEdit: boolean | null
}

export interface WorkflowUrgency {
  id: string
  code: string
  name: string
  seq: number | null
}

/** 只包含响应里实际出现的字段。缺失项用 null，不另造版本号。 */
export interface EasyWorkflowSnapshot {
  mailId: string
  flowId: string
  flowType: string
  flowSubType: string | null
  currentNodeId: string | null
  currentNodeCode: string | null
  currentNodeName: string | null
  status: number | null
  currentUserId: string | null
  currentUserName: string | null
  urgencyId: string | null
  /** 只使用响应里的 update_time_ss。字段缺失时为 null。 */
  versionToken: string | null
  deptId: string | null
  allowEdit: boolean | null
  availableNodes: WorkflowNode[]
  /** GetFlowSubmit 的响应正文没有保存。这里的节点来自页面脚本形状，不能当成已核对响应。 */
  submitContract: 'unverified'
  history: WorkflowHistory[]
  activity: WorkflowActivity | null
  urgencies: WorkflowUrgency[]
}

export interface WorkflowPlan {
  mailId: string
  flowId: string
  auditType: AuditType
  node: WorkflowNode
  reviewer: WorkflowReviewer
  self: boolean
  urgencyId: string
  remark: string
  versionToken: string | null
  params: Record<string, string> | null
  blockers: string[]
}

export interface WorkflowExecutionRecord {
  executionId: string
  mailId: string
  flowType: string
  flowId: string
  currentNodeId: string
  nextNodeId: string
  reviewerId: string
  status: WorkflowExecutionState
  versionToken: string
  submittedAt: string
  lastVerifiedAt: string
  lastError: string
  requestSent: boolean
  userId: string
  origin: string
}

export interface WorkflowView {
  record: WorkflowExecutionRecord
  snapshot: EasyWorkflowSnapshot | null
  plan: WorkflowPlan | null
  blockers: string[]
}
