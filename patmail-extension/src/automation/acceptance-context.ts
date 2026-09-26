import { sha256Hex } from './sha256'
import type { LiveAcceptanceRecord } from './acceptance-runner'
import { readonlyContract } from './readonly-contracts'

export interface ReadonlyAcceptanceContext {
  caseTypeId?: string
  mailId?: string
  flowType?: string
  expectedFields?: Record<string, string>
}

/** 缺少业务参数，或请求字段尚未核对时，不发请求。 */
export function acceptanceBlockReason(call: string, context: ReadonlyAcceptanceContext): string {
  const decision = readonlyContract(call, context)
  return decision.state === 'ready' ? '' : decision.reason
}

export function acceptanceForm(call: string, context: ReadonlyAcceptanceContext): URLSearchParams {
  const decision = readonlyContract(call, context)
  return decision.state === 'ready' ? decision.params : new URLSearchParams({ Call: call })
}

export function blockedAcceptance(input: { origin: string; operatorId: string; call: string; reason: string }): LiveAcceptanceRecord {
  const partial = {
    id: globalThis.crypto.randomUUID(),
    origin: input.origin,
    operatorId: input.operatorId,
    call: input.call,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    httpStatus: 0,
    businessStatus: 'unconfirmed',
    requestShape: input.call,
    responseShape: 'blocked',
    validatedFields: [] as string[],
    matchedWithUi: false,
    evidenceLevel: 'NONE' as const,
    result: 'BLOCKED' as const,
    reason: input.reason
  }
  return {
    ...partial,
    evidenceHash: sha256Hex(JSON.stringify({ call: partial.call, httpStatus: 0, result: 'BLOCKED', fields: [], shape: 'blocked' }))
  }
}
