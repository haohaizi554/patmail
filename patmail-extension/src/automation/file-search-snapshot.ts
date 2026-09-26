import { sha256Hex } from './sha256'

/** 只证明文件出现在当前受控查询响应里，不等于按 ID 回读。 */
export interface VerifiedFileSearchSnapshot {
  easyOrigin: string
  operatorId: string
  easyTabId: number
  connectionVersion: number
  queryFingerprint: string
  queryTime: string
  files: Array<{ fileId: string; fileName: string; fileDescription: string; customerName: string; caseVolume: string }>
  source: 'EASY_API_RESPONSE'
}

const cache = new Map<string, VerifiedFileSearchSnapshot>()

function cacheKey(origin: string, operatorId: string): string {
  return `${origin}\u0000${operatorId}`
}

export function rememberFileSearch(snapshot: VerifiedFileSearchSnapshot): void {
  cache.set(cacheKey(snapshot.easyOrigin, snapshot.operatorId), snapshot)
}

export function fileSearchFor(origin: string, operatorId: string): VerifiedFileSearchSnapshot | null {
  return cache.get(cacheKey(origin, operatorId)) ?? null
}

export function snapshotFromItems(scope: { easyOrigin: string; operatorId: string; easyTabId: number; connectionVersion: number }, items: readonly { fileId?: string; fileName?: string; fileDescription?: string; customerName?: string; caseVolume?: string }[], queryTime: string): VerifiedFileSearchSnapshot {
  const files = items.flatMap(item => {
    const fileId = typeof item.fileId === 'string' ? item.fileId : ''
    if (!fileId) return []
    return [{
      fileId,
      fileName: typeof item.fileName === 'string' ? item.fileName : '',
      fileDescription: typeof item.fileDescription === 'string' ? item.fileDescription : '',
      customerName: typeof item.customerName === 'string' ? item.customerName : '',
      caseVolume: typeof item.caseVolume === 'string' ? item.caseVolume : ''
    }]
  })
  return {
    ...scope,
    queryFingerprint: sha256Hex(JSON.stringify(files.map(item => item.fileId).sort())),
    queryTime,
    files,
    source: 'EASY_API_RESPONSE'
  }
}

export function provenanceFor(fileIds: string[], snapshot: VerifiedFileSearchSnapshot | null, scope: { easyOrigin: string; operatorId: string; easyTabId: number; connectionVersion: number }): 'FILE_SOURCE_UNVERIFIED' | 'SEARCH_RESPONSE_OBSERVED' {
  if (!snapshot || snapshot.source !== 'EASY_API_RESPONSE') return 'FILE_SOURCE_UNVERIFIED'
  if (snapshot.easyOrigin !== scope.easyOrigin || snapshot.operatorId !== scope.operatorId || snapshot.easyTabId !== scope.easyTabId || snapshot.connectionVersion !== scope.connectionVersion) {
    return 'FILE_SOURCE_UNVERIFIED'
  }
  const known = new Set(snapshot.files.map(item => item.fileId))
  if (fileIds.length === 0 || fileIds.some(id => !known.has(id))) return 'FILE_SOURCE_UNVERIFIED'
  return 'SEARCH_RESPONSE_OBSERVED'
}
