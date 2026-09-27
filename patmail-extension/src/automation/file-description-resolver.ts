import type { FileTypeNode } from '../api/dictionaries/types'
import { isQueryGuid } from '../query/query-validator'

export interface DictionaryScope {
  easyOrigin: string
  operatorId: string
  easyTabId: number
  connectionVersion: number
}

const trees = new Map<string, FileTypeNode[]>()

function treeKey(scope: DictionaryScope, caseTypeId: string): string {
  return [scope.easyOrigin, scope.operatorId, String(scope.easyTabId), String(scope.connectionVersion), caseTypeId].join('\u0000')
}

/** 字典来自 Background 已确认的文件描述树。页面不能直接提交一棵树来获得可信 ID。 */
export function rememberFileTypeTree(scope: DictionaryScope, caseTypeId: string, nodes: FileTypeNode[]): void {
  if (!isQueryGuid(caseTypeId)) return
  trees.set(treeKey(scope, caseTypeId), nodes.map(node => ({ ...node, childIds: [...node.childIds] })))
}

export function fileTypeTreeFor(scope: DictionaryScope, caseTypeId: string): FileTypeNode[] {
  return trees.get(treeKey(scope, caseTypeId)) ?? []
}

export function clearFileTypeTrees(): void {
  trees.clear()
}

/**
 * 只接受名称完全一致、案件类型明确、且唯一的合法节点。
 * 多条匹配时不取第一项。
 */
export function resolveFileDescriptionIdentity(text: string, nodes: FileTypeNode[], caseTypeId: string): { fileDescriptionId?: string; verified: boolean } {
  const name = text.trim()
  if (!name || !isQueryGuid(caseTypeId)) return { verified: false }
  const matches = nodes.filter(node => node.name === name && isQueryGuid(node.id))
  if (matches.length !== 1) return { verified: false }
  return { fileDescriptionId: matches[0]!.id, verified: true }
}
