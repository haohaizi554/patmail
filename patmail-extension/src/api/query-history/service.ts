import { isQueryGuid } from '../../query/query-validator'
import { isRecord } from '../../shared/guards'
import { apiError, type ApiResult } from '../types'
import type { EasyTransport } from '../transport'
import { normalizeHistoryDetail, normalizeHistoryOptions } from './normalizer'
import { historyRequest, type HistorySurface } from './surfaces'
import type { HistoryQueryDetail, HistoryQueryOption } from './types'

const CACHE_MS = 10 * 60_000

export class HistoryQueryService {
  private cache: { userKey: string; surface: HistorySurface; options: HistoryQueryOption[]; expires: number } | null = null

  constructor(private readonly transport: EasyTransport, private readonly now: () => number = Date.now) {}

  invalidate(): void {
    this.cache = null
  }

  async list(userKey: string, surface: HistorySurface, force: boolean, signal?: AbortSignal): Promise<ApiResult<HistoryQueryOption[]>> {
    if (!force && this.cache && this.cache.userKey === userKey && this.cache.surface === surface && this.cache.expires > this.now()) {
      return { ok: true, data: this.cache.options.map(item => ({ ...item })) }
    }
    const previous = this.cache && this.cache.userKey === userKey && this.cache.surface === surface
      ? this.cache.options.map(item => ({ ...item }))
      : null
    const response = await this.transport.post('historyQuery', historyRequest(surface, ''), signal)
    if (!response.ok) return previous ? { ok: true, data: previous } : response
    const options = normalizeHistoryOptions(response.data)
    if (!options.ok) return previous ? { ok: true, data: previous } : options
    this.cache = { userKey, surface, options: options.data, expires: this.now() + CACHE_MS }
    return { ok: true, data: options.data.map(item => ({ ...item })) }
  }

  async detail(userKey: string, surface: HistorySurface, queryId: string, signal?: AbortSignal): Promise<ApiResult<HistoryQueryDetail>> {
    const id = queryId.trim()
    if (!isQueryGuid(id)) return apiError('INVALID_QUERY', '历史模板 ID 无效。')
    const response = await this.transport.post('historyQuery', historyRequest(surface, id), signal)
    if (!response.ok) return response
    const detail = normalizeHistoryDetail(response.data, id)
    if (!detail.ok) return detail
    const cachedName = this.cache?.userKey === userKey && this.cache.surface === surface
      ? this.cache.options.find(item => item.id === id)?.name
      : undefined
    const options = isRecord(response.data) ? response.data.Options : undefined
    if (Array.isArray(options)) {
      const listed = normalizeHistoryOptions(response.data)
      if (listed.ok) this.cache = { userKey, surface, options: listed.data, expires: this.now() + CACHE_MS }
    }
    const name = detail.data.name ?? cachedName
    if (!name) return apiError('INVALID_RESPONSE', '历史模板详情没有标题。')
    return { ok: true, data: { id, name, queryXml: detail.data.queryXml } }
  }
}
