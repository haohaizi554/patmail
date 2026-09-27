import { isLiveWriteCall } from '../automation/live-readonly-policy'
import { extractReadonlyEvidence, readonlyContract } from '../automation/readonly-contracts'
import { CURRENT_ENVIRONMENT } from './config'
import { DictionaryService } from './dictionaries'
import type { DictionaryLoadRequest, DictionarySnapshot } from './dictionaries'
import { buildGetSearchFilesFromFields, buildGetSearchFilesParams, type FileSearchQuery } from './file-search-params'
import { buildLimitMonitorParams, type LimitMonitorQuery } from './limit-monitor-params'
import { normalizeLimitMonitor } from './limit-monitor-normalizer'
import type { LimitMonitorResult } from './limit-monitor-types'
import { HistoryQueryService } from './query-history'
import type { HistoryQueryDetail, HistoryQueryOption } from './query-history'
import type { FileSearchResult } from './file-search-types'
import { normalizeFileSearch } from './file-search-normalizer'
import { SessionService, type SessionStatus, type SessionSummary } from './session'
import { productionGate, type MailWriteGate } from '../mail/easy/gate'
import { MailExecutionRuntime, type SelectionClaim } from '../mail/easy/runtime'
import { ExecutionStore, type ExecutionArea } from '../mail/easy/store'
import type { MailExecutionView } from '../mail/easy/types'
import type { MailDraftPreview } from '../mail/types'
import { productionWorkflowGate } from '../workflow/gate'
import { WorkflowRuntime } from '../workflow/runtime'
import { WorkflowStore } from '../workflow/store'
import type { WorkflowView } from '../workflow/types'
import type { PlanInput } from '../workflow/planner'
import { EasyMailReadService } from '../mail/easy/read-service'
import type { ExistingMailDiagnostic } from '../shared/message'
import { EasyTransport, type EasyOperation, type TransportOptions } from './transport'
import { apiError, type ApiResult } from './types'

export interface RuntimeOptions extends TransportOptions {
  mailStore?: ExecutionStore
  mailGate?: MailWriteGate
}

function chromeExecutionArea(): ExecutionArea | null {
  const area = globalThis.chrome?.storage?.local
  if (!area) return null
  return {
    get: key => area.get(key) as Promise<Record<string, unknown>>,
    set: items => area.set(items)
  }
}

const ACCEPTANCE_ROUTE: Record<string, EasyOperation> = {
  GetUserModel: 'session',
  GetSearchFiles: 'fileSearch',
  IPGetBasicData: 'basicData',
  GetFlowdirection: 'flowDirection',
  LoadFileTypeByCaseType: 'fileTypeTree',
  LoadMailType: 'mailType',
  GetMailInfo: 'getMailInfo',
  GetMailFile: 'getMailFile',
  GetMailCase: 'getMailCase',
  GetMailRule: 'getMailRule',
  GetCustomerContact: 'getCustomerContact',
  GetSignature: 'getSignature',
  GetFlowInfo: 'getFlowInfo',
  GetFlowHistory: 'getFlowHistory',
  GetUrgencyList: 'getUrgencyList',
  GetFlowSubmit: 'getFlowSubmit',
  GetFlowLastStatus: 'getFlowLastStatus'
}

function refusedWorkflow(message: string): WorkflowView {
  return {
    record: {
      executionId: '', mailId: '', flowType: '', flowId: '', currentNodeId: '', nextNodeId: '', reviewerId: '',
      status: 'BLOCKED', versionToken: '', submittedAt: '', lastVerifiedAt: '', lastError: message,
      requestSent: false, userId: '', origin: ''
    },
    snapshot: null, plan: null, blockers: [message]
  }
}

function refusedMailView(preview: MailDraftPreview, message: string, executionId = ''): MailExecutionView {
  return {
    record: {
      executionId, userId: '', origin: '', customerProfileId: preview.customerProfileId, fileIds: [...preview.fileIds],
      mailTypeId: preview.mailTypeId, ruleRevision: 0, fingerprint: preview.fingerprint, state: 'FAILED',
      mailId: '', stage: 'FAILED', lastError: message, requestSent: false, diffDigest: '', updatedAt: new Date().toISOString()
    },
    diffs: [], linkedFileIds: [], blockers: [message]
  }
}

export class EasyRuntime {
  private readonly transport: EasyTransport
  private readonly session: SessionService
  private sessionController: AbortController | null = null
  private searchController: AbortController | null = null
  private searchSequence = 0
  private limitController: AbortController | null = null
  private limitSequence = 0
  private activeSearch: { signature: string; promise: Promise<ApiResult<FileSearchResult>> } | null = null
  private readonly history: HistoryQueryService
  private readonly dictionaries: DictionaryService
  private historyUserKey = ''
  private listColsel: string | null = null
  private readonly mail: MailExecutionRuntime
  private readonly workflow: WorkflowRuntime

  constructor(pageOrigin: string, options: RuntimeOptions = {}) {
    this.transport = new EasyTransport(pageOrigin, options)
    this.session = new SessionService(this.transport)
    this.history = new HistoryQueryService(this.transport)
    this.dictionaries = new DictionaryService(this.transport)
    this.mail = new MailExecutionRuntime(
      this.transport,
      options.mailStore ?? new ExecutionStore(chromeExecutionArea()),
      options.mailGate ?? productionGate,
      pageOrigin
    )
    this.workflow = new WorkflowRuntime(
      this.transport,
      new WorkflowStore(chromeExecutionArea()),
      productionWorkflowGate,
      pageOrigin,
      (userId, mailId) => this.mail.hasVerifiedMail(userId, mailId)
    )
  }

  get sessionStatus(): SessionStatus { return this.session.status }

  async checkSession(): Promise<ApiResult<SessionSummary>> {
    this.cancelSessionCheck()
    const controller = new AbortController()
    this.sessionController = controller
    const result = await this.session.check(controller.signal)
    if (this.sessionController === controller) this.sessionController = null
    if (result.ok && result.data.status !== 'authenticated') {
      this.cancelFileSearch()
      this.cancelLimitMonitor()
    }
    if (!result.ok && result.error.code === 'SESSION_EXPIRED') {
      this.cancelFileSearch()
      this.cancelLimitMonitor()
    }
    const nextKey = result.ok && result.data.status === 'authenticated' ? result.data.userId ?? '' : ''
    if (nextKey !== this.historyUserKey) {
      this.history.invalidate()
      this.dictionaries.invalidate(this.historyUserKey)
      this.dictionaries.invalidate(nextKey)
      this.listColsel = null
    }
    this.historyUserKey = nextKey
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
    const signature = JSON.stringify(query.resolvedFields ? [
      'resolved',
      Object.keys(query.resolvedFields).sort().map(key => [key, query.resolvedFields?.[key] ?? '']),
      query.pageIndex, query.pageSize
    ] : [
      query.caseVolume?.trim() ?? '', query.applicationNo?.trim() ?? '',
      query.customerName?.trim() ?? '', query.fileName?.trim() ?? '',
      query.fileDescriptionId?.trim() ?? '', query.pageIndex, query.pageSize
    ])
    if (this.activeSearch?.signature === signature) return this.activeSearch.promise
    const environment = this.listColsel ? { ...CURRENT_ENVIRONMENT, colsel: this.listColsel } : CURRENT_ENVIRONMENT
    const params = query.resolvedFields
      ? buildGetSearchFilesFromFields(query.resolvedFields, query, environment)
      : buildGetSearchFilesParams(query, environment)
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

  loadDictionary(request: DictionaryLoadRequest, signal?: AbortSignal): Promise<ApiResult<DictionarySnapshot>> {
    if (this.session.status !== 'authenticated') {
      return Promise.resolve(apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。'))
    }
    const caseTypeId = request.kind === 'fileType' ? request.caseTypeId : ''
    return this.dictionaries.load(request.kind, this.historyUserKey, request.force, caseTypeId, signal).then(result => {
      if (request.kind === 'listColumn' && result.ok && result.data.kind === 'listColumn' && result.data.colsel) {
        this.listColsel = result.data.colsel
      }
      return result
    })
  }

  listHistoryQueries(force = false, signal?: AbortSignal): Promise<ApiResult<HistoryQueryOption[]>> {
    if (this.session.status !== 'authenticated') {
      return Promise.resolve(apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。'))
    }
    return this.history.list(this.historyUserKey, force, signal)
  }

  getHistoryQuery(queryId: string, signal?: AbortSignal): Promise<ApiResult<HistoryQueryDetail>> {
    if (this.session.status !== 'authenticated') {
      return Promise.resolve(apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。'))
    }
    return this.history.detail(this.historyUserKey, queryId, signal)
  }

  private async mailUser(): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
    const session = await this.checkSession()
    if (!session.ok || session.data.status !== 'authenticated' || !session.data.userId) {
      return { ok: false, message: '请先在 EASY 原网站登录并检测登录状态。' }
    }
    return { ok: true, userId: session.data.userId }
  }

  findMailExecution(fingerprint: string): Promise<MailExecutionView | null> {
    return this.mailUser().then(user => user.ok ? this.mail.find(user.userId, fingerprint) : null)
  }

  createEasyMail(preview: MailDraftPreview, claim: SelectionClaim): Promise<MailExecutionView> {
    return this.mailUser().then(user => user.ok
      ? this.mail.create(user.userId, preview, claim)
      : refusedMailView(preview, user.message))
  }

  saveEasyMail(executionId: string, preview: MailDraftPreview, claim: SelectionClaim, acknowledgedDigest: string): Promise<MailExecutionView> {
    return this.mailUser().then(user => user.ok
      ? this.mail.save(user.userId, executionId, preview, claim, acknowledgedDigest)
      : refusedMailView(preview, user.message, executionId))
  }

  inspectEasyMail(executionId: string): Promise<MailExecutionView | null> {
    return this.mailUser().then(user => user.ok ? this.mail.inspect(user.userId, executionId) : null)
  }

  readWorkflow(mailId: string, flowType: string): Promise<WorkflowView> {
    return this.mailUser().then(user => user.ok ? this.workflow.read(user.userId, mailId, flowType) : refusedWorkflow(user.message))
  }

  refreshWorkflow(executionId: string): Promise<WorkflowView> {
    return this.mailUser().then(user => user.ok ? this.workflow.refresh(user.userId, executionId) : refusedWorkflow(user.message))
  }

  previewWorkflow(executionId: string, input: Omit<PlanInput, 'currentUserId' | 'pageFields'>): Promise<WorkflowView> {
    return this.mailUser().then(user => user.ok
      ? this.workflow.preview(user.userId, executionId, { ...input, currentUserId: user.userId, pageFields: null })
      : refusedWorkflow(user.message))
  }

  restoreWorkflow(mailId: string): Promise<WorkflowView | null> {
    return this.mailUser().then(user => user.ok ? this.workflow.restore(user.userId, mailId) : null)
  }

  /** 只读验收探测。写接口不在表内，不会发请求。 */
  async probeReadonly(call: string, context: { caseTypeId?: string; mailId?: string; flowType?: string } = {}): Promise<{ httpStatus: number; sessionOk: boolean; fields: Record<string, string>; shape: string }> {
    if (isLiveWriteCall(call)) return { httpStatus: 0, sessionOk: true, fields: {}, shape: 'write-blocked' }
    const operation = ACCEPTANCE_ROUTE[call]
    const decision = readonlyContract(call, context)
    if (!operation || decision.state !== 'ready') return { httpStatus: 0, sessionOk: true, fields: {}, shape: decision.state === 'pending' ? 'CONTRACT_PENDING' : 'blocked' }
    const response = await this.transport.post(operation, decision.params)
    if (!response.ok) {
      return {
        httpStatus: response.error.status ?? (response.error.code === 'SESSION_EXPIRED' ? 401 : 0),
        sessionOk: response.error.code !== 'SESSION_EXPIRED',
        fields: {},
        shape: response.error.code
      }
    }
    const data = response.data
    const fields = extractReadonlyEvidence(call, data)
    const shape = data && typeof data === 'object' ? `object(${Object.keys(data as object).sort().join(',')})` : typeof data
    return { httpStatus: 200, sessionOk: fields.clientLogin !== 'false' && fields.loginPage !== 'true', fields, shape }
  }

  /** 只读核验一封已有邮件。不保存、不提交。 */
  diagnoseExistingMail(mailId: string, flowType: string): Promise<ExistingMailDiagnostic> {
    return this.mailUser().then(async user => {
      if (!user.ok) {
        return { mailId, fileIds: [], fileNames: [], writesAttempted: false, blockers: [user.message], workflow: refusedWorkflow(user.message) }
      }
      const mail = await new EasyMailReadService(this.transport).load(mailId)
      const workflow = await this.workflow.diagnose(user.userId, mailId, flowType)
      return {
        mailId,
        fileIds: mail.ok ? mail.snapshot.files.map(file => file.fileId) : [],
        fileNames: mail.ok ? mail.snapshot.files.map(file => file.fileName) : [],
        writesAttempted: false,
        blockers: [mail.ok ? '' : mail.message, ...workflow.blockers].filter(Boolean),
        workflow
      }
    })
  }

  searchLimitMonitor(query: LimitMonitorQuery): Promise<ApiResult<LimitMonitorResult>> {
    if (this.session.status !== 'authenticated') {
      return Promise.resolve(apiError(
        this.session.status === 'expired' || this.session.status === 'unauthenticated' ? 'SESSION_EXPIRED' : 'AUTH_UNKNOWN',
        '请先在 EASY 原网站登录并检测登录状态。'
      ))
    }
    const params = buildLimitMonitorParams(query)
    if (!params.ok) return Promise.resolve(params)
    this.cancelLimitMonitor()
    const controller = new AbortController()
    this.limitController = controller
    const requestNumber = ++this.limitSequence
    return (async (): Promise<ApiResult<LimitMonitorResult>> => {
      const response = await this.transport.post('limitMonitor', params.data, controller.signal)
      if (requestNumber !== this.limitSequence) return apiError('REQUEST_ABORTED', '旧查询已取消。')
      const result = response.ok ? normalizeLimitMonitor(response.data, query) : response
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') {
        this.session.expire()
        this.cancelLimitMonitor()
      }
      return result
    })()
  }

  cancelLimitMonitor(): void {
    this.limitSequence++
    this.limitController?.abort()
    this.limitController = null
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
    this.cancelLimitMonitor()
    this.history.invalidate()
    this.dictionaries.invalidate(this.historyUserKey)
    this.historyUserKey = ''
    this.listColsel = null
    this.session.clear()
  }
}
