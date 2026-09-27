import type { AutomationTask, EvidencePersistence } from './types'

export interface EvidenceAccount {
  easyOrigin: string
  operatorId: string
  easyTabId?: number
  connectionVersion?: number
}

export interface EvidenceEvaluation {
  historicalObservation: boolean
  persistence: EvidencePersistence | 'UNKNOWN'
  freshness: 'FRESH' | 'EXPIRED' | 'UNKNOWN'
  recoverability: 'RESTORABLE' | 'NOT_RESTORABLE' | 'UNKNOWN'
  requiresRevalidation: boolean
  message: string
}

/** 用任务里已经记下的观察时间和失效时间判断当前是否还能当作有效证据。不改写 fetchedAt。 */
export function evaluateTaskEvidence(task: AutomationTask, currentAccount: EvidenceAccount | null, now: string): EvidenceEvaluation {
  const selections = task.verifiedSelection ?? []
  const historicalObservation = selections.some(item => item.historicalObservation || item.verification === 'SEARCH_RESPONSE_OBSERVED' || Boolean(item.fetchedAt))
  const persistence = task.identityGate?.persistence ?? 'UNKNOWN'
  const dated = selections.filter(item => item.evidenceExpiresAt && (item.historicalObservation || item.verification === 'SEARCH_RESPONSE_OBSERVED' || item.fetchedAt))
  const freshness = dated.length === 0
    ? 'UNKNOWN'
    : dated.every(item => Date.parse(item.evidenceExpiresAt ?? '') > Date.parse(now)) ? 'FRESH' : 'EXPIRED'
  const recoverability = persistence === 'PERSISTED' ? 'RESTORABLE' : persistence === 'MEMORY_ONLY' || persistence === 'FAILED' ? 'NOT_RESTORABLE' : 'UNKNOWN'
  const recoveryPending = selections.some(item => item.recoveryState === 'RECOVERED_PENDING_REVALIDATION')
  const accountMismatch = Boolean(currentAccount && (currentAccount.easyOrigin !== task.origin || currentAccount.operatorId !== task.operatorId))
  const requiresRevalidation = freshness === 'EXPIRED' || recoveryPending || accountMismatch || persistence === 'FAILED' || persistence === 'MEMORY_ONLY'
  const message = accountMismatch
    ? '当前账号与任务来源不一致，请重新查询。'
    : freshness === 'EXPIRED'
      ? '查询证据已过期，请重新查询。'
      : recoveryPending
        ? '历史查询已恢复，需要重新查询后才能继续。'
        : persistence === 'MEMORY_ONLY' || persistence === 'FAILED'
          ? '查询来源尚未持久化，执行前需要重新核验。'
          : ''
  return { historicalObservation, persistence, freshness, recoverability, requiresRevalidation, message }
}
