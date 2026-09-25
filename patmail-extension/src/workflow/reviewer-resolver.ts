import { isQueryGuid } from '../query/query-validator'
import type { WorkflowNode, WorkflowReviewer } from './types'

/** 只返回当前选中节点上的候选人，不把其他节点的人员并进来。 */
export function reviewersForNode(nodes: WorkflowNode[], nodeId: string): WorkflowReviewer[] {
  if (!nodeId) return []
  return nodes.find(node => node.nodeId.toLowerCase() === nodeId.toLowerCase())?.reviewers ?? []
}

export type ReviewerResolution =
  | { status: 'matched'; reviewer: WorkflowReviewer }
  | { status: 'blocked'; reason: string }

/**
 * 只接受当前用户 GUID 与候选 GUID 相同。
 * 姓名相同、缺少 GUID、或候选人里没有当前用户，都保持阻塞。
 */
export function resolveReviewer(currentUserId: string | null, node: WorkflowNode, selectedId = ''): ReviewerResolution {
  if (!currentUserId || !isQueryGuid(currentUserId)) return { status: 'blocked', reason: '当前 EASY 用户 GUID 还没有确认。' }
  if (node.reviewerFormat === 'unknown' || node.reviewers.length === 0) {
    return { status: 'blocked', reason: '候选人缺少已确认的内部 GUID，不能按姓名选择。' }
  }
  const names = new Map<string, number>()
  for (const reviewer of node.reviewers) {
    if (!isQueryGuid(reviewer.id)) return { status: 'blocked', reason: '候选人缺少已确认的内部 GUID，不能按姓名选择。' }
    const name = reviewer.name.trim()
    if (name) names.set(name, (names.get(name) ?? 0) + 1)
  }
  if ([...names.values()].some(count => count > 1) && !selectedId) {
    return { status: 'blocked', reason: '存在多个同名审核人，不能按姓名选择。' }
  }
  const self = node.reviewers.find(reviewer => reviewer.id.toLowerCase() === currentUserId.toLowerCase())
  if (!self) return { status: 'blocked', reason: '当前用户不在候选审核人中，不能改选其他人。' }
  if (selectedId && selectedId.toLowerCase() !== currentUserId.toLowerCase()) {
    return { status: 'blocked', reason: '不能选择当前用户以外的审核人。' }
  }
  return { status: 'matched', reviewer: self }
}
