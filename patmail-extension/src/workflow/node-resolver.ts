import type { WorkflowNode } from './types'

export type NodeResolution =
  | { kind: 'none' }
  | { kind: 'one'; node: WorkflowNode }
  | { kind: 'many'; nodes: WorkflowNode[] }
  | { kind: 'missing' }

/** 只有一个下一节点时才确定。多个节点必须由调用方给出节点 ID。 */
export function resolveNextNodes(nodes: WorkflowNode[], selectedId = ''): NodeResolution {
  const usable = nodes.filter(node => node.nodeId)
  if (usable.length === 0) return { kind: 'none' }
  if (!selectedId) return usable.length === 1 ? { kind: 'one', node: usable[0]! } : { kind: 'many', nodes: usable }
  const found = usable.find(node => node.nodeId.toLowerCase() === selectedId.toLowerCase())
  return found ? { kind: 'one', node: found } : { kind: 'missing' }
}
