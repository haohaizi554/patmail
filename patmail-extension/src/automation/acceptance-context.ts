import { sha256Hex } from './sha256'
import type { LiveAcceptanceRecord } from './acceptance-runner'
import { isQueryGuid } from '../query/query-validator'

export interface ReadonlyAcceptanceContext {
  caseTypeId?: string
  mailId?: string
  flowType?: string
  expectedFields?: Record<string, string>
}

const MAIL_CALLS = new Set(['GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetMailRule', 'GetCustomerContact', 'GetSignature'])
const FLOW_CALLS = new Set(['GetFlowInfo', 'GetFlowHistory', 'GetFlowSubmit', 'GetFlowLastStatus'])

/** 缺少业务参数时不发请求。 */
export function acceptanceBlockReason(call: string, context: ReadonlyAcceptanceContext): string {
  if (call === 'LoadFileTypeByCaseType' && !isQueryGuid(context.caseTypeId ?? '')) return 'LoadFileTypeByCaseType 需要真实案件类型 ID。'
  if (MAIL_CALLS.has(call) && !isQueryGuid(context.mailId ?? '')) return `${call} 需要已有测试邮件 ID。`
  if (FLOW_CALLS.has(call) && !isQueryGuid(context.mailId ?? '')) return `${call} 需要已有邮件 ID。`
  if (FLOW_CALLS.has(call) && !context.flowType?.trim()) return `${call} 需要流程类型。`
  return ''
}

export function acceptanceForm(call: string, context: ReadonlyAcceptanceContext): URLSearchParams {
  const params = new URLSearchParams({ Call: call })
  if (context.caseTypeId && isQueryGuid(context.caseTypeId)) params.set('case_type_id', context.caseTypeId)
  if (context.mailId && isQueryGuid(context.mailId)) params.set('mail_id', context.mailId)
  if (context.flowType?.trim()) params.set('flow_type', context.flowType.trim().slice(0, 20))
  return params
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
    result: 'BLOCKED' as const,
    reason: input.reason
  }
  return {
    ...partial,
    evidenceHash: sha256Hex(JSON.stringify({ call: partial.call, httpStatus: 0, result: 'BLOCKED', fields: [], shape: 'blocked' }))
  }
}
