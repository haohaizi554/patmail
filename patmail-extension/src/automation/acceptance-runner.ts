import { redactText } from './contract-capture'
import { sha256Hex } from './sha256'

export const READONLY_ACCEPTANCE_CALLS = [
  'GetUserModel', 'GetSearchFiles', 'IPGetBasicData', 'GetFlowdirection', 'LoadFileTypeByCaseType', 'LoadMailType',
  'GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetMailRule', 'GetCustomerContact', 'GetSignature',
  'GetFlowInfo', 'GetFlowHistory', 'GetUrgencyList', 'GetFlowSubmit', 'GetFlowLastStatus'
] as const

const READONLY = new Set<string>(READONLY_ACCEPTANCE_CALLS)
const WRITE_CALLS = new Set(['MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd'])

export type AcceptanceResult = 'PASS' | 'FAIL' | 'BLOCKED'
export type AcceptanceEvidenceLevel = 'NONE' | 'REQUEST_OBSERVED' | 'RESPONSE_OBSERVED' | 'BUSINESS_VALIDATED' | 'UI_COMPARED' | 'READBACK_VERIFIED'

export interface LiveAcceptanceRecord {
  id: string
  origin: string
  operatorId: string
  call: string
  startedAt: string
  finishedAt: string
  httpStatus: number
  businessStatus: string
  requestShape: string
  responseShape: string
  validatedFields: string[]
  matchedWithUi: boolean
  evidenceLevel?: AcceptanceEvidenceLevel
  result: AcceptanceResult
  reason: string
  evidenceHash: string
}

export interface AcceptanceExchange {
  kind: 'live' | 'mock'
  call(name: string): Promise<{ httpStatus: number; sessionOk: boolean; fields: Record<string, string>; shape: string }>
}

function cleanFields(fields: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (/cookie|authorization|password|token|mail_body|mail_to|mail_cc|email/i.test(key)) continue
    output[key] = redactText(value).slice(0, 120)
  }
  return output
}

function acceptanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(item => item.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function record(partial: Omit<LiveAcceptanceRecord, 'evidenceHash' | 'evidenceLevel'>): LiveAcceptanceRecord {
  const evidenceLevel: AcceptanceEvidenceLevel = partial.result === 'BLOCKED'
    ? 'NONE'
    : partial.httpStatus === 502 || partial.httpStatus === 503 || partial.httpStatus < 200 || partial.httpStatus >= 300
      ? (partial.httpStatus > 0 ? 'REQUEST_OBSERVED' : 'NONE')
      : partial.result === 'FAIL'
        ? 'RESPONSE_OBSERVED'
        : partial.result === 'PASS' && partial.matchedWithUi
          ? 'UI_COMPARED'
          : partial.result === 'PASS'
            ? 'RESPONSE_OBSERVED'
            : 'NONE'
  const evidenceHash = sha256Hex(JSON.stringify({
    call: partial.call, httpStatus: partial.httpStatus, result: partial.result,
    fields: partial.validatedFields, shape: partial.responseShape
  }))
  return { ...partial, evidenceLevel, evidenceHash }
}

/** 只调用白名单里的只读接口。写接口和 Mock 都不会被当成现场通过。 */
export class LiveEasyAcceptanceRunner {
  constructor(private readonly exchange: AcceptanceExchange) {}

  async run(input: {
    origin: string
    operatorId: string
    call: string
    expected?: Record<string, string>
    now?: string
  }): Promise<LiveAcceptanceRecord> {
    const startedAt = input.now ?? new Date().toISOString()
    const base = {
      id: acceptanceId(),
      origin: input.origin,
      operatorId: input.operatorId,
      call: input.call,
      startedAt,
      finishedAt: startedAt,
      httpStatus: 0,
      businessStatus: '',
      requestShape: input.call,
      responseShape: '',
      validatedFields: [] as string[],
      matchedWithUi: false
    }
    if (WRITE_CALLS.has(input.call) || !READONLY.has(input.call)) {
      return record({ ...base, result: 'BLOCKED', reason: '只读验收不能调用写接口。' })
    }
    if (this.exchange.kind !== 'live') {
      return record({ ...base, result: 'BLOCKED', reason: 'Mock 响应不能作为现场证据。' })
    }
    const response = await this.exchange.call(input.call)
    const fields = cleanFields(response.fields)
    const finishedAt = new Date().toISOString()
    const expected = cleanFields(input.expected ?? {})
    const mismatches = Object.keys(expected).filter(key => fields[key] !== expected[key])
    let result: AcceptanceResult = 'BLOCKED'
    let reason = '缺少与原网页对照的字段，不能记为通过。'
    if (!response.sessionOk) {
      result = 'FAIL'
      reason = '登录已失效。'
    } else if (response.httpStatus === 502 || response.httpStatus === 503) {
      result = 'FAIL'
      reason = `${input.call} 返回 ${response.httpStatus}。`
    } else if (response.httpStatus < 200 || response.httpStatus >= 300) {
      result = 'FAIL'
      reason = `${input.call} 没有成功响应。`
    } else if (fields.clientStatus === 'false' || fields.clientLogin === 'false' || fields.loginPage === 'true') {
      result = 'FAIL'
      reason = 'HTTP 200，但业务状态未通过。'
    } else if (mismatches.length > 0) {
      result = 'FAIL'
      reason = `字段不一致：${mismatches.join('、')}`
    } else if (Object.keys(expected).length > 0) {
      result = 'PASS'
      reason = '与原网站 UI 对照通过。'
    } else if (input.call === 'GetUserModel' && fields.userId) {
      result = 'PASS'
      reason = '只读响应结构通过。'
    }
    return record({
      ...base,
      finishedAt,
      httpStatus: response.httpStatus,
      businessStatus: result === 'PASS' ? 'matched' : 'unconfirmed',
      responseShape: response.shape,
      validatedFields: Object.keys(expected).length > 0 ? Object.keys(expected) : Object.keys(fields),
      matchedWithUi: result === 'PASS' && Object.keys(expected).length > 0,
      result,
      reason
    })
  }
}
