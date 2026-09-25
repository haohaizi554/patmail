import type { EvidenceLevel } from './types'

export interface ContractSample {
  handler: string
  call: string
  method: string
  contentType: string
  statusCode: number
  requestFieldNames: string[]
  responseShape: string
  businessSuccess: boolean
  redirected: boolean
  followupReadEndpoint: string
  readbackMatched: boolean
  source: 'live' | 'mock' | 'page-script'
  observedAt: string
}

const SECRET = /cookie|authorization|password|token|mail_body|mail_subject|mail_to|mail_cc|email/i
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function redactText(value: string): string {
  return value.replace(EMAIL, '[redacted-email]').replace(/Bearer\s+\S+/gi, '[redacted-token]')
}

export function redactRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRecord)
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactText(value) : value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET.test(key) ? '[redacted]' : redactRecord(item)
  }
  return output
}

function shapeOf(value: unknown): string {
  if (value == null || value === '') return 'empty'
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return `object(${Object.keys(value as object).sort().join(',')})`
  return typeof value
}

/** 从脱敏后的交换记录判断证据等级。Mock 和 502、空响应都不能升到回读核验。 */
export function analyzeExchange(input: {
  handler: string
  call: string
  method?: string
  contentType?: string
  statusCode: number
  request: Record<string, unknown>
  response: unknown
  redirected?: boolean
  followupReadEndpoint?: string
  readbackMatched?: boolean
  source: ContractSample['source']
  observedAt?: string
}): ContractSample {
  const request = redactRecord(input.request) as Record<string, unknown>
  const response = redactRecord(input.response)
  const statusCode = input.statusCode
  const responseShape = shapeOf(response)
  const businessSuccess = statusCode >= 200 && statusCode < 300 && responseShape !== 'empty' && input.source !== 'mock'
  return {
    handler: input.handler,
    call: input.call,
    method: input.method ?? 'POST',
    contentType: input.contentType ?? 'application/x-www-form-urlencoded; charset=UTF-8',
    statusCode,
    requestFieldNames: Object.keys(request).sort(),
    responseShape,
    businessSuccess,
    redirected: input.redirected === true,
    followupReadEndpoint: input.followupReadEndpoint ?? '',
    readbackMatched: input.readbackMatched === true && businessSuccess,
    source: input.source,
    observedAt: input.observedAt ?? new Date().toISOString()
  }
}

export function evidenceLevel(samples: ContractSample[], call: string): EvidenceLevel {
  const rows = samples.filter(item => item.call === call && item.source !== 'mock')
  if (rows.some(item => item.readbackMatched && item.businessSuccess)) return 'READBACK_VERIFIED'
  if (rows.some(item => item.businessSuccess)) return 'RESPONSE_OBSERVED'
  if (rows.some(item => item.requestFieldNames.length > 0)) return 'REQUEST_OBSERVED'
  return 'UNKNOWN'
}

/** 静态目录上的 responseCaptured 不参与判断。写开关关闭时结果始终是关闭。 */
export function productionWriteAllowed(): false {
  return false
}
