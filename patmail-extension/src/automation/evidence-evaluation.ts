import type { FileQuerySession, ObservedPatentFile, QuerySessionRepository } from './file-search-snapshot'
import type { AutomationTask, EvidencePersistence, VerifiedSelectionSnapshot } from './types'

export interface EvidenceAccount {
  easyOrigin: string
  operatorId: string
  easyTabId?: number
  connectionVersion?: number
}

export type CurrentEvidenceReason =
  | 'CURRENT_VERIFIED'
  | 'QUERY_SUPERSEDED'
  | 'FILE_REMOVED'
  | 'FILE_FIELDS_CHANGED'
  | 'EVIDENCE_EXPIRED'
  | 'RECOVERED_PENDING_REVALIDATION'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'ACCOUNT_MISMATCH'
  | 'UNKNOWN'

export interface HistoricalFileEvidence {
  fileId: string
  fetchedAt: string
  fileName: string
  fileDescription: string
  querySessionId: string
  verification: VerifiedSelectionSnapshot['verification']
}

export interface FileCurrentEvidence {
  fileId: string
  reason: CurrentEvidenceReason
  currentTrust: boolean
  historical: HistoricalFileEvidence
  message: string
}

export interface EvidenceEvaluation {
  historicalObservation: boolean
  persistence: EvidencePersistence | 'UNKNOWN'
  freshness: 'FRESH' | 'EXPIRED' | 'UNKNOWN'
  /** 磁盘上能否读回历史记录。不能把它理解成当前可以执行。 */
  recoverability: 'RESTORABLE' | 'NOT_RESTORABLE' | 'UNKNOWN'
  currentTrust: boolean
  requiresRevalidation: boolean
  message: string
}

export interface CurrentEvidenceEvaluation extends EvidenceEvaluation {
  reason: CurrentEvidenceReason
  files: FileCurrentEvidence[]
}

const REASON_RANK: CurrentEvidenceReason[] = [
  'ACCOUNT_MISMATCH',
  'UNKNOWN',
  'QUERY_SUPERSEDED',
  'RECOVERED_PENDING_REVALIDATION',
  'FILE_REMOVED',
  'FILE_FIELDS_CHANGED',
  'EVIDENCE_EXPIRED',
  'PERSISTENCE_UNAVAILABLE',
  'CURRENT_VERIFIED'
]

/** 每一份文件都要有明确状态。缺字段不能被滤掉后再当成已持久化。 */
export function aggregatePersistence(items: VerifiedSelectionSnapshot[]): EvidencePersistence | 'UNKNOWN' {
  if (items.length === 0) return 'UNKNOWN'
  if (items.some(item => item.persistence === 'FAILED')) return 'FAILED'
  if (items.some(item => item.persistence === 'MEMORY_ONLY')) return 'MEMORY_ONLY'
  if (items.every(item => item.persistence === 'PERSISTED')) return 'PERSISTED'
  return 'UNKNOWN'
}

function needsSource(items: VerifiedSelectionSnapshot[]): boolean {
  return items.some(item => item.verification === 'SEARCH_RESPONSE_OBSERVED' || Boolean(item.querySessionId) || item.historicalObservation === true)
}

function selectionClock(item: VerifiedSelectionSnapshot, now: string): 'missing' | 'invalid' | 'expired' | 'fresh' {
  if (!item.evidenceExpiresAt) return 'missing'
  const time = Date.parse(item.evidenceExpiresAt)
  if (!Number.isFinite(time)) return 'invalid'
  return time <= Date.parse(now) ? 'expired' : 'fresh'
}

/** 只读任务里已经记下的观察。不访问当前查询运行，也不改写 fetchedAt。 */
export function evaluateTaskEvidence(task: AutomationTask, currentAccount: EvidenceAccount | null, now: string): EvidenceEvaluation {
  const selections = task.verifiedSelection ?? []
  const historicalObservation = selections.some(item => item.historicalObservation || item.verification === 'SEARCH_RESPONSE_OBSERVED' || Boolean(item.fetchedAt))
  const persistence = selections.length > 0 ? aggregatePersistence(selections) : (task.identityGate?.persistence ?? 'UNKNOWN')
  const clocks = selections.map(item => selectionClock(item, now))
  const freshness = selections.length === 0
    ? 'UNKNOWN'
    : clocks.some(item => item === 'expired')
      ? 'EXPIRED'
      : clocks.every(item => item === 'fresh')
        ? 'FRESH'
        : 'UNKNOWN'
  const recoverability = persistence === 'PERSISTED' ? 'RESTORABLE' : persistence === 'MEMORY_ONLY' || persistence === 'FAILED' ? 'NOT_RESTORABLE' : 'UNKNOWN'
  const recoveryPending = selections.some(item => item.recoveryState === 'RECOVERED_PENDING_REVALIDATION')
  const accountMismatch = Boolean(currentAccount && (currentAccount.easyOrigin !== task.origin || currentAccount.operatorId !== task.operatorId))
  const incomplete = needsSource(selections) && (freshness === 'UNKNOWN' || persistence === 'UNKNOWN')
  const requiresRevalidation = freshness === 'EXPIRED' || recoveryPending || accountMismatch || persistence === 'FAILED' || persistence === 'MEMORY_ONLY' || incomplete
  const currentTrust = freshness === 'FRESH' && persistence === 'PERSISTED' && !requiresRevalidation
  const message = accountMismatch
    ? '当前账号与任务来源不一致，请重新查询。'
    : freshness === 'EXPIRED'
      ? '查询证据已过期，请重新查询。'
      : recoveryPending
        ? '历史查询已恢复，需要重新查询后才能继续。'
        : persistence === 'MEMORY_ONLY' || persistence === 'FAILED'
          ? '查询来源尚未持久化，执行前需要重新核验。'
          : incomplete
            ? '查询来源不完整，需要重新查询。'
            : ''
  return { historicalObservation, persistence, freshness, recoverability, currentTrust, requiresRevalidation, message }
}

function historicalOf(item: VerifiedSelectionSnapshot): HistoricalFileEvidence {
  return {
    fileId: item.fileId,
    fetchedAt: item.fetchedAt,
    fileName: item.fileName || item.fileId,
    fileDescription: item.fileDescription,
    querySessionId: item.querySessionId ?? '',
    verification: item.verification
  }
}

function fileMessage(reason: CurrentEvidenceReason, item: VerifiedSelectionSnapshot): string {
  const name = item.fileName || item.fileId
  const when = item.fetchedAt || '未知时间'
  if (reason === 'FILE_REMOVED') return `文件 ${name} 曾在 ${when} 被查询到。当前查询结果已不再包含该文件，需要重新查询。`
  if (reason === 'FILE_FIELDS_CHANGED') return `文件 ${name} 曾在 ${when} 被查询到。当前查询中的名称、描述、客户或案件已经变化，需要重新查询。`
  if (reason === 'EVIDENCE_EXPIRED') return '查询证据已过期，请重新查询。'
  if (reason === 'RECOVERED_PENDING_REVALIDATION') return '历史查询已恢复，需要重新查询后才能继续。'
  if (reason === 'PERSISTENCE_UNAVAILABLE') return '查询来源尚未持久化，执行前需要重新核验。'
  if (reason === 'QUERY_SUPERSEDED') return '查询运行已不再是当前绑定下的有效结果，需要重新查询。'
  if (reason === 'ACCOUNT_MISMATCH') return '当前账号与任务来源不一致，请重新查询。'
  if (reason === 'UNKNOWN') return '当前查询运行无法确认，需要重新查询。'
  return ''
}

function worse(left: CurrentEvidenceReason, right: CurrentEvidenceReason): CurrentEvidenceReason {
  return REASON_RANK.indexOf(left) <= REASON_RANK.indexOf(right) ? left : right
}

function pageStillValid(page: FileQuerySession['pages'][number], now: number): boolean {
  return Date.parse(page.evidenceExpiresAt) > now
}

function copiesOf(session: FileQuerySession, fileId: string): ObservedPatentFile[] {
  return session.pages.flatMap(page => page.files.filter(file => file.fileId === fileId))
}

function liveCopies(session: FileQuerySession, fileId: string, now: number): ObservedPatentFile[] {
  return session.pages
    .filter(page => pageStillValid(page, now))
    .flatMap(page => page.files.filter(file => file.fileId === fileId && !file.conflict))
}

function fieldsChanged(item: VerifiedSelectionSnapshot, source: ObservedPatentFile): boolean {
  const pairs: Array<[string | undefined, string]> = [
    [item.fileName, source.fileName],
    [item.fileDescription, source.fileDescription],
    [item.sourceCustomerName, source.customerName],
    [item.caseVolume, source.caseVolume],
    [item.caseId, source.caseId]
  ]
  return pairs.some(([saved, observed]) => saved !== undefined && saved.trim() !== observed)
}

function scopeMismatch(session: FileQuerySession, account: EvidenceAccount): boolean {
  if (account.easyTabId == null || account.connectionVersion == null) return false
  return session.easyTabId !== account.easyTabId || session.connectionVersion !== account.connectionVersion
}

function claimsSource(item: VerifiedSelectionSnapshot): boolean {
  return item.verification === 'SEARCH_RESPONSE_OBSERVED' || Boolean(item.querySessionId) || item.historicalObservation === true
}

function reasonForFile(item: VerifiedSelectionSnapshot, session: FileQuerySession | null, account: EvidenceAccount, now: string): CurrentEvidenceReason {
  if (!claimsSource(item)) return 'UNKNOWN'
  if (account.easyOrigin !== item.easyOrigin || account.operatorId !== item.operatorId) return 'ACCOUNT_MISMATCH'
  if (!item.querySessionId || !session) return 'UNKNOWN'
  if (session.easyOrigin !== account.easyOrigin || session.operatorId !== account.operatorId || scopeMismatch(session, account)) return 'QUERY_SUPERSEDED'
  if (session.status === 'STALE' || session.status === 'CONFLICT') return 'QUERY_SUPERSEDED'
  if (session.status === 'EXPIRED') return 'EVIDENCE_EXPIRED'
  const present = copiesOf(session, item.fileId)
  if (present.length === 0) return 'FILE_REMOVED'
  if (session.recoveryState === 'RECOVERED_PENDING_REVALIDATION') return 'RECOVERED_PENDING_REVALIDATION'
  const clock = selectionClock(item, now)
  if (clock === 'expired') return 'EVIDENCE_EXPIRED'
  if (clock === 'missing' || clock === 'invalid') return 'UNKNOWN'
  const live = liveCopies(session, item.fileId, Date.parse(now))
  if (live.length === 0) return 'EVIDENCE_EXPIRED'
  if (live.some(source => fieldsChanged(item, source)) || live.some(source => source.fileName !== live[0]?.fileName || source.fileDescription !== live[0]?.fileDescription || source.customerName !== live[0]?.customerName || source.caseId !== live[0]?.caseId || source.caseVolume !== live[0]?.caseVolume)) return 'FILE_FIELDS_CHANGED'
  if (session.persistence !== 'PERSISTED') return 'PERSISTENCE_UNAVAILABLE'
  return 'CURRENT_VERIFIED'
}

/**
 * 用当前查询运行核对任务里的历史证据。
 * 历史 fetchedAt 留在任务上，这里只返回当前是否还能当作来源。
 */
export async function evaluateCurrentTaskEvidence(
  task: AutomationTask,
  account: EvidenceAccount,
  repository: QuerySessionRepository,
  now: string
): Promise<CurrentEvidenceEvaluation> {
  const snapshot = evaluateTaskEvidence(task, account, now)
  const selections = task.verifiedSelection ?? []
  if (account.easyOrigin !== task.origin || account.operatorId !== task.operatorId) {
    return {
      ...snapshot,
      reason: 'ACCOUNT_MISMATCH',
      currentTrust: false,
      requiresRevalidation: true,
      message: '当前账号与任务来源不一致，请重新查询。',
      files: selections.map(item => ({
        fileId: item.fileId,
        reason: 'ACCOUNT_MISMATCH',
        currentTrust: false,
        historical: historicalOf(item),
        message: '当前账号与任务来源不一致，请重新查询。'
      }))
    }
  }
  if (selections.length === 0) {
    return { ...snapshot, reason: 'UNKNOWN', currentTrust: false, requiresRevalidation: false, files: [] }
  }
  const at = Date.parse(now)
  const files: FileCurrentEvidence[] = []
  for (const item of selections) {
    const session = item.querySessionId ? await repository.read(item.querySessionId, Number.isFinite(at) ? at : Date.now()) : null
    const reason = reasonForFile(item, session, account, now)
    files.push({
      fileId: item.fileId,
      reason,
      currentTrust: reason === 'CURRENT_VERIFIED',
      historical: historicalOf(item),
      message: fileMessage(reason, item)
    })
  }
  if (!needsSource(selections)) {
    return { ...snapshot, reason: 'UNKNOWN', currentTrust: false, requiresRevalidation: snapshot.requiresRevalidation, files, message: snapshot.message }
  }
  const reason = files.reduce<CurrentEvidenceReason>((current, item) => worse(current, item.reason), 'CURRENT_VERIFIED')
  const currentTrust = files.every(item => item.currentTrust)
  const requiresRevalidation = !currentTrust
  const detailed = files.find(item => item.reason === reason)?.message
  const message = reason === 'CURRENT_VERIFIED'
    ? ''
    : reason === 'EVIDENCE_EXPIRED'
      ? '查询证据已过期，请重新查询。'
      : detailed || snapshot.message || '查询证据需要重新核验。'
  return {
    ...snapshot,
    reason,
    files,
    currentTrust,
    requiresRevalidation,
    message
  }
}
