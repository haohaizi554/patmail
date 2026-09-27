import { isQueryGuid } from '../query/query-validator'
import type { FileTypeNode } from '../api/dictionaries/types'

export interface FileTypeSource {
  id: unknown
  name: unknown
  pid: unknown
  seq: unknown
  tree_level: unknown
}

export interface BuiltFileTypeTree {
  nodes: FileTypeNode[]
  rootIds: string[]
  diagnostics: string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 用 id、pid、seq 建树。重复 ID、无效父节点和环只记诊断，不改已有 ID。 */
export function buildFileTypeTree(rows: unknown[]): BuiltFileTypeTree {
  const diagnostics: string[] = []
  const nodes: FileTypeNode[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      diagnostics.push('忽略了无法识别的文件描述节点。')
      continue
    }
    const source = row as FileTypeSource
    const id = text(source.id)
    const name = text(source.name)
    if (!isQueryGuid(id) || !name) {
      diagnostics.push('忽略了缺少 ID 或名称的文件描述节点。')
      continue
    }
    if (seen.has(id)) {
      diagnostics.push('忽略了重复的文件描述节点。')
      continue
    }
    seen.add(id)
    const order = typeof source.seq === 'number' && Number.isFinite(source.seq) ? source.seq : nodes.length
    const treeType = text((source as { TreeType?: unknown }).TreeType)
    nodes.push({ id, name, parentId: text(source.pid), order, childIds: [], ...(treeType ? { treeType } : {}) })
  }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const roots: FileTypeNode[] = []
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (!node.parentId) roots.push(node)
    else if (!parent) {
      diagnostics.push('文件描述存在无效父节点。')
      node.parentId = ''
      roots.push(node)
    } else parent.childIds.push(node.id)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const breakCycle = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) return
    visiting.add(id)
    const node = byId.get(id)
    if (node) {
      node.childIds = node.childIds.filter(childId => {
        if (visiting.has(childId)) {
          diagnostics.push('文件描述树存在环形引用。')
          return false
        }
        breakCycle(childId)
        return true
      })
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const node of nodes) breakCycle(node.id)
  const sortIds = (ids: string[]): string[] => ids
    .map(id => byId.get(id))
    .filter((node): node is FileTypeNode => Boolean(node))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'zh'))
    .map(node => node.id)
  for (const node of nodes) node.childIds = sortIds(node.childIds)
  return {
    nodes,
    rootIds: sortIds(roots.map(node => node.id)),
    diagnostics
  }
}

export function searchFileTypeNodes(nodes: FileTypeNode[], query: string, limit = 50): string[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return nodes.filter(node => node.name.toLocaleLowerCase().includes(needle)).slice(0, limit).map(node => node.id)
}
