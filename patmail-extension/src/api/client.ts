import { buildGetSearchFilesParams, type FileSearchQuery } from './file-search-params'
import type { FileSearchResult } from './file-search-types'
import { normalizeFileSearch } from './file-search-normalizer'
import { SessionService, type SessionStatus, type SessionSummary } from './session'
import { EasyTransport, type TransportOptions } from './transport'
import { apiError, type ApiResult } from './types'

export class EasyRuntime {
  private readonly transport: EasyTransport
  private readonly session: SessionService
  private sessionController: AbortController | null = null
  private searchController: AbortController | null = null
  private searchSequence = 0
  private activeSearch: { signature: string; promise: Promise<ApiResult<FileSearchResult>> } | null = null

  constructor(pageOrigin: string, options: TransportOptions = {}) {
    this.transport = new EasyTransport(pageOrigin, options)
    this.session = new SessionService(this.transport)
  }

  get sessionStatus(): SessionStatus { return this.session.status }

  async checkSession(): Promise<ApiResult<SessionSummary>> {
    this.cancelSessionCheck()
    const controller = new AbortController()
    this.sessionController = controller
    const result = await this.session.check(controller.signal)
    if (this.sessionController === controller) this.sessionController = null
    if (result.ok && result.data.status !== 'authenticated') this.cancelFileSearch()
    if (!result.ok && result.error.code === 'SESSION_EXPIRED') this.cancelFileSearch()
    return result
  }

  cancelSessionCheck(): void {
    this.sessionController?.abort()
    this.sessionController = null
  }

  searchFiles(query: FileSearchQuery): Promise<ApiResult<FileSearchResult>> {
    if (this.session.status !== 'authenticated') {
      return Promise.resolve(apiError(
        this.session.status === 'expired' || this.session.status === 'unauthenticated' ? 'SESSION_EXPIRED' : 'AUTH_UNKNOWN',
        '请先在 EASY 原网站登录并检测登录状态。'
      ))
    }
    const signature = JSON.stringify([
      query.caseVolume?.trim() ?? '', query.applicationNo?.trim() ?? '',
      query.customerName?.trim() ?? '', query.fileName?.trim() ?? '',
      query.fileDescriptionId?.trim() ?? '', query.pageIndex, query.pageSize
    ])
    if (this.activeSearch?.signature === signature) return this.activeSearch.promise
    const params = buildGetSearchFilesParams(query)
    if (!params.ok) return Promise.resolve(params)
    this.cancelFileSearch()
    const controller = new AbortController()
    this.searchController = controller
    const requestNumber = ++this.searchSequence
    const promise = (async (): Promise<ApiResult<FileSearchResult>> => {
      const response = await this.transport.post('fileSearch', params.data, controller.signal)
      if (requestNumber !== this.searchSequence) return apiError('REQUEST_ABORTED', '旧查询已取消。')
      const result = response.ok ? normalizeFileSearch(response.data, query) : response
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') {
        this.session.expire()
        this.cancelFileSearch()
      }
      return result
    })()
    this.activeSearch = { signature, promise }
    void promise.then(() => {
      if (this.activeSearch?.promise === promise) {
        this.activeSearch = null
        this.searchController = null
      }
    })
    return promise
  }

  cancelFileSearch(): void {
    this.searchSequence++
    this.searchController?.abort()
    this.searchController = null
    this.activeSearch = null
  }

  dispose(): void {
    this.cancelSessionCheck()
    this.cancelFileSearch()
    this.session.clear()
  }
}
