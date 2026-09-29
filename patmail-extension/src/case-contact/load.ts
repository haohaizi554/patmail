import { businessMessage, readClientInfo, isRecord } from '../api/response-guards'
import { apiError, type ApiResult } from '../api/types'
import type { EasyOperation, EasyTransport } from '../api/transport'
import {
  agencySearchParams,
  caseInfoParams,
  firstInventorEmail,
  patentDataParams,
  searchHits,
  shownVolume,
  techUserText,
  type CaseContactExport,
  type CaseContactRow,
  type CaseHit
} from './query'

const PAGE_SIZE = 200
const POOL = 4

type ContactCall = Extract<EasyOperation, 'agencySearchCase' | 'agencyCaseInfo' | 'patentCaseData'>

function hasCasePayload(data: Record<string, unknown>): boolean {
  return Array.isArray(data.TableRows) || Array.isArray(data.Inventors) || Array.isArray(data.p_case_info)
}

function sessionEnded(data: unknown): ApiResult<never> | null {
  if (!isRecord(data) || hasCasePayload(data)) return null
  const client = readClientInfo(data.ClientInfo)
  if (!client.ok) return null
  if (client.data.IsLogin === false) return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效，请在原网站重新登录。')
  if (client.data.Status === false) return apiError('BUSINESS_ERROR', businessMessage(client.data))
  return null
}

function sessionFailure(result: ApiResult<unknown>): ApiResult<never> | null {
  if (result.ok || result.error.code !== 'SESSION_EXPIRED') return null
  return result
}

async function post(transport: EasyTransport, operation: ContactCall, params: URLSearchParams, signal?: AbortSignal): Promise<ApiResult<unknown>> {
  const response = await transport.post(operation, params, signal)
  if (!response.ok) return response
  const ended = sessionEnded(response.data)
  if (ended) return ended
  return response
}

async function searchAll(transport: EasyTransport, volumes: string[], pageUserId: string, signal?: AbortSignal): Promise<ApiResult<CaseHit[]>> {
  const found: CaseHit[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY
  while (found.length < total && page <= 5) {
    const response = await post(transport, 'agencySearchCase', agencySearchParams(volumes, pageUserId, page, PAGE_SIZE), signal)
    if (!response.ok) return response
    const parsed = searchHits(response.data)
    if (!parsed) return apiError('INVALID_RESPONSE', '案件查询没有返回列表。')
    found.push(...parsed.hits)
    total = parsed.total
    if (parsed.hits.length === 0) break
    page += 1
  }
  return { ok: true, data: found }
}

async function mapPool<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, () => worker()))
  return output
}

/** 按清单顺序读客户案号、技术负责人和第一发明人邮箱。 */
export async function loadCaseContacts(transport: EasyTransport, pageUserId: string, volumes: string[], signal?: AbortSignal): Promise<ApiResult<CaseContactExport>> {
  const listed = await searchAll(transport, volumes, pageUserId, signal)
  if (!listed.ok) return listed
  const byVolume = new Map<string, CaseHit>()
  for (const hit of listed.data) {
    if (!byVolume.has(hit.volume)) byVolume.set(hit.volume, hit)
  }
  const unmatched = volumes.filter(volume => !byVolume.has(volume))
  const failed: string[] = []
  let expired: ApiResult<never> | null = null
  const details = await mapPool(volumes, async (volume): Promise<CaseContactRow> => {
    const hit = byVolume.get(volume)
    if (!hit || expired) return { volume, tech: '', email: '' }
    const [info, patent] = await Promise.all([
      post(transport, 'agencyCaseInfo', caseInfoParams(hit.caseId), signal),
      post(transport, 'patentCaseData', patentDataParams(hit.caseId), signal)
    ])
    const ended = sessionFailure(info) ?? sessionFailure(patent)
    if (ended) {
      expired = ended
      return { volume, tech: '', email: '' }
    }
    if (!info.ok || !patent.ok) {
      failed.push(volume)
      return { volume, tech: '', email: '' }
    }
    return {
      volume: shownVolume(patent.data, volume),
      tech: techUserText(patent.data),
      email: firstInventorEmail(info.data)
    }
  })
  if (expired) return expired
  return { ok: true, data: { rows: details, unmatched, failed } }
}
