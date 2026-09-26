import { sealEvidence, type StoredEvidence } from './evidence-store'
import { redactText } from './contract-capture'

const ALLOWED = new Set([
  'GetUserModel', 'GetSearchFiles', 'IPGetBasicData', 'GetFlowdirection', 'LoadFileTypeByCaseType', 'LoadMailType',
  'GetMailInfo', 'GetMailFile', 'GetMailCase', 'GetMailRule', 'GetCustomerContact', 'GetSignature',
  'GetFlowInfo', 'GetFlowHistory', 'GetUrgencyList', 'GetFlowSubmit', 'GetFlowLastStatus',
  'MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd'
])

const READBACK: Record<string, string> = {
  MailCustomer: 'GetMailInfo',
  SaveMailInfo: 'GetMailInfo',
  SaveMailRalteCaseFile: 'GetMailFile',
  FlowSubmit: 'GetFlowInfo',
  EndEmailFlowd: 'GetFlowInfo'
}

interface HarHeader { name?: string; value?: string }
interface HarEntry {
  startedDateTime?: string
  request?: { method?: string; url?: string; headers?: HarHeader[]; postData?: { mimeType?: string; text?: string } }
  response?: { status?: number; headers?: HarHeader[]; redirectURL?: string; content?: { mimeType?: string; text?: string } }
}

function paramsOf(text: string): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(text)) output[key] = value
  return output
}

function fieldNames(record: Record<string, string>): string {
  return Object.keys(record).filter(key => !/cookie|authorization|password|token|mail_body|mail_subject|mail_to|mail_cc|email/i.test(key)).sort().join(',')
}

function shapeOf(text: string | undefined): string {
  if (!text || !text.trim()) return 'empty'
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object') return typeof parsed
    return `object(${Object.keys(parsed as object).sort().join(',')})`
  } catch {
    return 'text'
  }
}

/** 只保留目标 Origin 的白名单 Call，并去掉凭据、正文和邮箱。 */
export function importHar(raw: unknown, origin: string, operatorId: string): StoredEvidence[] {
  if (!raw || typeof raw !== 'object') return []
  const entries = (raw as { log?: { entries?: HarEntry[] } }).log?.entries
  if (!Array.isArray(entries)) return []
  const rows: StoredEvidence[] = []
  let pending: StoredEvidence | null = null
  for (const entry of entries) {
    let url: URL
    try { url = new URL(entry.request?.url ?? '') } catch { continue }
    if (url.origin !== origin) continue
    const headerText = [...(entry.request?.headers ?? []), ...(entry.response?.headers ?? [])]
      .map(item => `${item.name ?? ''}:${item.value ?? ''}`).join('\n')
    if (/set-cookie|authorization|cookie/i.test(headerText)) {
      // 头只用于丢弃，不进入证据。
    }
    const body = paramsOf(entry.request?.postData?.text ?? '')
    const call = body.Call || url.searchParams.get('Call') || ''
    if (!ALLOWED.has(call)) continue
    const responseText = entry.response?.content?.text
    const readback = READBACK[call]
    const row = sealEvidence({
      handler: url.pathname,
      call,
      origin,
      operatorId,
      requestShape: fieldNames(body) || 'empty',
      responseShape: shapeOf(responseText),
      httpStatus: entry.response?.status ?? 0,
      businessSuccess: false,
      readbackCall: readback ?? '',
      readbackMatched: false,
      source: 'CAPTURED_HAR',
      capturedAt: entry.startedDateTime ?? new Date().toISOString(),
      verifiedAt: ''
    })
    if (pending && pending.readbackCall === call && !pending.readbackMatched) {
      pending.readbackMatched = false
      pending = null
    }
    rows.push(row)
    if (readback) pending = row
    if (responseText && /@/.test(responseText)) row.responseShape = redactText(row.responseShape)
  }
  return rows.filter(item => !/cookie|authorization|set-cookie|@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(item)))
}
