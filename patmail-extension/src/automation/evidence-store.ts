import { redactRecord, redactText } from './contract-capture'
import type { EvidenceLevel } from './types'
import { sha256Hex } from './sha256'

export type EvidenceSource = 'LIVE' | 'CAPTURED_HAR' | 'PAGE_SCRIPT' | 'MOCK'

export interface StoredEvidence {
  evidenceId: string
  handler: string
  call: string
  origin: string
  operatorIdHash: string
  requestShape: string
  responseShape: string
  httpStatus: number
  businessSuccess: boolean
  readbackCall: string
  readbackMatched: boolean
  source: EvidenceSource
  level: EvidenceLevel
  capturedAt: string
  verifiedAt: string
  sampleHash: string
}

const SECRET = /cookie|authorization|password|token|mail_body|mail_subject|mail_to|mail_cc|set-cookie|email/i

export function hashOperator(operatorId: string): string {
  return sha256Hex(operatorId)
}

export function evidenceLevelOf(input: Pick<StoredEvidence, 'source' | 'businessSuccess' | 'readbackMatched' | 'requestShape'>): EvidenceLevel {
  if (input.source === 'MOCK') return 'UNKNOWN'
  if (input.readbackMatched && input.businessSuccess) return 'READBACK_VERIFIED'
  if (input.businessSuccess) return 'RESPONSE_OBSERVED'
  if (input.requestShape && input.requestShape !== 'empty') return 'REQUEST_OBSERVED'
  return 'UNKNOWN'
}

export function sealEvidence(input: Omit<StoredEvidence, 'evidenceId' | 'level' | 'sampleHash' | 'operatorIdHash'> & { operatorId: string; evidenceId?: string }): StoredEvidence {
  const requestShape = redactText(input.requestShape)
  const responseShape = redactText(input.responseShape)
  const row: StoredEvidence = {
    evidenceId: input.evidenceId ?? globalThis.crypto.randomUUID(),
    handler: input.handler,
    call: input.call,
    origin: input.origin,
    operatorIdHash: hashOperator(input.operatorId),
    requestShape,
    responseShape,
    httpStatus: input.httpStatus,
    businessSuccess: input.source === 'MOCK' ? false : input.businessSuccess,
    readbackCall: input.readbackCall,
    readbackMatched: input.source === 'MOCK' ? false : input.readbackMatched,
    source: input.source,
    level: 'UNKNOWN',
    capturedAt: input.capturedAt,
    verifiedAt: input.verifiedAt,
    sampleHash: ''
  }
  row.level = evidenceLevelOf(row)
  row.sampleHash = sha256Hex(JSON.stringify(redactRecord({
    call: row.call, requestShape, responseShape, httpStatus: row.httpStatus, source: row.source, level: row.level
  })))
  return row
}

export interface EvidenceRepository {
  saveEvidence(row: StoredEvidence): Promise<void>
  listEvidence(origin: string, call?: string): Promise<StoredEvidence[]>
  saveAcceptance(row: import('./acceptance-runner').LiveAcceptanceRecord): Promise<void>
  listAcceptance(origin: string, operatorId: string): Promise<import('./acceptance-runner').LiveAcceptanceRecord[]>
}

export class MemoryEvidenceStore implements EvidenceRepository {
  readonly evidence: StoredEvidence[] = []
  readonly acceptance: import('./acceptance-runner').LiveAcceptanceRecord[] = []

  saveEvidence(row: StoredEvidence): Promise<void> {
    if (SECRET.test(JSON.stringify(row))) return Promise.reject(new Error('证据包含敏感字段。'))
    const index = this.evidence.findIndex(item => item.evidenceId === row.evidenceId)
    if (index >= 0) this.evidence[index] = row
    else this.evidence.push(row)
    return Promise.resolve()
  }

  listEvidence(origin: string, call = ''): Promise<StoredEvidence[]> {
    return Promise.resolve(this.evidence.filter(item => item.origin === origin && (call === '' || item.call === call)))
  }

  saveAcceptance(row: import('./acceptance-runner').LiveAcceptanceRecord): Promise<void> {
    const text = JSON.stringify(row)
    if (SECRET.test(text) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
      return Promise.reject(new Error('验收记录包含敏感字段。'))
    }
    this.acceptance.push(row)
    return Promise.resolve()
  }

  listAcceptance(origin: string, operatorId: string): Promise<import('./acceptance-runner').LiveAcceptanceRecord[]> {
    return Promise.resolve(this.acceptance.filter(item => item.origin === origin && item.operatorId === operatorId))
  }
}

interface EvidenceBundle {
  evidence: StoredEvidence[]
  acceptance: import('./acceptance-runner').LiveAcceptanceRecord[]
}

/** 证据放在扩展自己的 IndexedDB。一次事务里读取并写回。 */
export class IndexedEvidenceStore implements EvidenceRepository {
  private database: Promise<IDBDatabase> | null = null
  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open('patmail-evidence', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('rows')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.database
  }

  private async update(work: (bundle: EvidenceBundle) => void): Promise<EvidenceBundle> {
    const database = await this.open()
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('rows', 'readwrite')
      const store = tx.objectStore('rows')
      const current = store.get('bundle')
      let bundle: EvidenceBundle = { evidence: [], acceptance: [] }
      current.onsuccess = () => {
        bundle = current.result ?? { evidence: [], acceptance: [] }
        work(bundle)
        store.put(bundle, 'bundle')
      }
      current.onerror = () => reject(current.error)
      tx.oncomplete = () => resolve(bundle)
      tx.onerror = () => reject(tx.error)
    })
  }

  async saveEvidence(row: StoredEvidence): Promise<void> {
    await this.update(bundle => {
      const index = bundle.evidence.findIndex(item => item.evidenceId === row.evidenceId)
      if (index >= 0) bundle.evidence[index] = row
      else bundle.evidence.push(row)
    })
  }

  async listEvidence(origin: string, call = ''): Promise<StoredEvidence[]> {
    const bundle = await this.update(() => undefined)
    return bundle.evidence.filter(item => item.origin === origin && (call === '' || item.call === call))
  }

  async saveAcceptance(row: import('./acceptance-runner').LiveAcceptanceRecord): Promise<void> {
    await this.update(bundle => { bundle.acceptance.push(row) })
  }

  async listAcceptance(origin: string, operatorId: string): Promise<import('./acceptance-runner').LiveAcceptanceRecord[]> {
    const bundle = await this.update(() => undefined)
    return bundle.acceptance.filter(item => item.origin === origin && item.operatorId === operatorId)
  }
}
