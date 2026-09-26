import { sha256Hex } from './sha256'
import type { LiveAcceptanceRecord } from './acceptance-runner'
import { sealEvidence, type EvidenceSource, type StoredEvidence } from './evidence-store'
import { isRecord } from '../shared/guards'

export interface ReadonlyProbe {
  httpStatus: number
  sessionOk: boolean
  fields: Record<string, string>
  shape: string
}

export function isReadonlyProbe(value: unknown): value is ReadonlyProbe {
  return isRecord(value) && typeof value.httpStatus === 'number' && typeof value.sessionOk === 'boolean' &&
    typeof value.shape === 'string' && value.shape.length <= 500 && isRecord(value.fields) &&
    Object.values(value.fields).every(item => typeof item === 'string') && Object.keys(value.fields).length <= 20
}

/** 界面提交的通过结果不能成为正式证据。 */
export function downgradeClientAcceptance(record: LiveAcceptanceRecord): LiveAcceptanceRecord {
  const next: LiveAcceptanceRecord = {
    ...record,
    result: record.result === 'PASS' ? 'BLOCKED' : record.result,
    matchedWithUi: false,
    evidenceLevel: record.result === 'PASS' ? 'NONE' : record.evidenceLevel,
    reason: record.result === 'PASS' ? '界面提交不能成为验收通过证明。' : record.reason,
    businessStatus: record.result === 'PASS' ? 'unconfirmed' : record.businessStatus
  }
  next.evidenceHash = sha256Hex(JSON.stringify({
    call: next.call, httpStatus: next.httpStatus, result: next.result,
    fields: next.validatedFields, shape: next.responseShape
  }))
  return next
}

/** 证据等级由 seal 重新计算。界面声明的 READBACK_VERIFIED 不会保留。 */
export function downgradeClientEvidence(row: StoredEvidence): StoredEvidence {
  const source: EvidenceSource = row.source === 'CAPTURED_HAR' || row.source === 'MOCK' ? row.source : 'PAGE_SCRIPT'
  return sealEvidence({
    handler: row.handler,
    call: row.call,
    origin: row.origin,
    operatorId: 'untrusted-client',
    requestShape: row.requestShape,
    responseShape: row.responseShape,
    httpStatus: row.httpStatus,
    businessSuccess: false,
    readbackCall: row.readbackCall,
    readbackMatched: false,
    source,
    capturedAt: row.capturedAt,
    verifiedAt: ''
  })
}
