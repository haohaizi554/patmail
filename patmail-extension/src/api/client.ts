import { isLiveWriteCall } from '../automation/live-readonly-policy'
import { extractReadonlyEvidence, readonlyContract } from '../automation/readonly-contracts'
import { CURRENT_ENVIRONMENT, PCL_ORIGIN, trustedOrigin } from './config'
import { CASE_CONTACT_CUSTOMER_NAME } from '../customer/skills'
import { isWriteSwitchOpen } from '../settings/write-switch'
import { DictionaryService } from './dictionaries'
import type { DictionaryLoadRequest, DictionarySnapshot } from './dictionaries'
import { buildGetSearchFilesFromFields, buildGetSearchFilesParams, type FileSearchQuery } from './file-search-params'
import { buildLimitMonitorParams, type LimitMonitorQuery } from './limit-monitor-params'
import { buildMailProcessParams, buildProcessListParams, filingNeedsCpcFlag, normalizeMailProcess, normalizeProcessList, processFormPath, type ProcessKind, type ProcessListQuery, type ProcessListResult, type ProcessOpenTarget } from './mail-process'
import { isRecord } from './response-guards'
import { normalizeLimitMonitor } from './limit-monitor-normalizer'
import type { LimitMonitorResult } from './limit-monitor-types'
import { HistoryQueryService } from './query-history'
import type { HistoryQueryDetail, HistoryQueryOption, HistorySurface } from './query-history'
import type { FileSearchResult } from './file-search-types'
import { normalizeFileSearch } from './file-search-normalizer'
import { SessionService, type SessionStatus, type SessionSummary } from './session'
import { productionGate, type MailWriteGate } from '../mail/easy/gate'
import { MailExecutionRuntime, type SelectionClaim } from '../mail/easy/runtime'
import { ExecutionStore, type ExecutionArea } from '../mail/easy/store'
import type { MailExecutionView } from '../mail/easy/types'
import type { MailDraftPreview } from '../mail/types'
import { productionWorkflowGate } from '../workflow/gate'
import { WorkflowReadService } from '../workflow/read-service'
import type { AccountReviewerList } from '../workflow/contracts'
import { WorkflowRuntime } from '../workflow/runtime'
import { WorkflowStore } from '../workflow/store'
import type { WorkflowView } from '../workflow/types'
import type { PlanInput } from '../workflow/planner'
import { loadCaseDemandText, type CaseDemandAsset } from '../mail/easy/case-demand'
import { loadPctSendGate, type IcFlowAsk, type IcFlowHit, type PctSendGate } from '../customer/pct-flow-status'
import { lookupIcFlow } from '../customer/ic-flow-lookup'
import { loadCustomerDemands, loadCustomerDirectory, type CustomerDemandAsset, type CustomerDirectoryAsset } from '../customer/customer-page'
import { listParams, readMailInfo } from '../mail/easy/contracts'
import { loadMailContactText, type MailContactAsset } from '../mail/easy/mail-contacts'
import { isQueryGuid } from '../query/query-validator'
import { EasyMailReadService } from '../mail/easy/read-service'
import type { ExistingMailDiagnostic } from '../shared/message'
import { submitLimitMailBatch, type LimitMailSubmitItem, type LimitMailSubmitResult } from '../customer/limit-mail-submit'
import { loadCaseContacts } from '../case-contact/load'
import type { CaseContactExport } from '../case-contact/query'
import { EasyTransport, type EasyOperation, type TransportOptions } from './transport'
import { apiError, type ApiResult } from './types'

function readNewCpcFlag(data: unknown): boolean | null {
  if (!isRecord(data) || !Array.isArray(data.IsNewCPC) || !isRecord(data.IsNewCPC[0])) return null
  const flag = data.IsNewCPC[0].filing_new
  if (flag === true || flag === 1 || flag === '1') return true
  if (flag === false || flag === 0 || flag === '0') return false
  return null
}

function processOperation(kind: ProcessKind): EasyOperation {
  if (kind === 'AP') return 'processAP'
  if (kind === 'EF') return 'processEF'
  return 'mailProcess'
}

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

  constructor(private readonly pageOrigin: string, options: RuntimeOptions = {}) {
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

  private activeSession: Promise<ApiResult<SessionSummary>> | null = null

  async checkSession(): Promise<ApiResult<SessionSummary>> {
    if (this.activeSession) return this.activeSession
    const controller = new AbortController()
    this.sessionController = controller
    const run = (async () => {
      const result = await this.session.check(controller.signal)
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
    })()
    this.activeSession = run
    try {
      return await run
    } finally {
      if (this.activeSession === run) this.activeSession = null
      if (this.sessionController === controller) this.sessionController = null
    }
  }

  /** 进入页面时顺手确认会话。已经登录则直接过；检测被取消时再试一次。 */
  private async confirmAccountRead(): Promise<boolean> {
    if (this.session.status === 'authenticated') return true
    const result = await this.checkSession()
    if (result.ok && result.data.status === 'authenticated') return true
    if (!result.ok && result.error.code === 'REQUEST_ABORTED') {
      const retry = await this.checkSession()
      return retry.ok && retry.data.status === 'authenticated'
    }
    return false
  }

  cancelSessionCheck(): void {
    this.sessionController?.abort()
    this.sessionController = null
    this.activeSession = null
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

  async loadDictionary(request: DictionaryLoadRequest, signal?: AbortSignal): Promise<ApiResult<DictionarySnapshot>> {
    if (!(await this.confirmAccountRead())) {
      return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
    }
    const caseTypeId = request.kind === 'fileType' || request.kind === 'picker' ? request.caseTypeId ?? '' : ''
    const picker = request.kind === 'picker' ? { country: request.country ?? '', procType: request.procType ?? '' } : {}
    return this.dictionaries.load(request.kind, this.historyUserKey, request.force, caseTypeId, signal, picker).then(result => {
      if (request.kind === 'listColumn' && result.ok && result.data.kind === 'listColumn' && result.data.colsel) {
        this.listColsel = result.data.colsel
      }
      return result
    })
  }

  async listHistoryQueries(force = false, signal?: AbortSignal, surface: HistorySurface = 'file'): Promise<ApiResult<HistoryQueryOption[]>> {
    await this.confirmAccountRead()
    return this.history.list(this.historyUserKey, surface, force, signal)
  }

  async getHistoryQuery(queryId: string, signal?: AbortSignal, surface: HistorySurface = 'file'): Promise<ApiResult<HistoryQueryDetail>> {
    await this.confirmAccountRead()
    return this.history.detail(this.historyUserKey, surface, queryId, signal)
  }

  async saveHistoryQuery(title: string, queryId: string, queryXml: string, signal?: AbortSignal): Promise<ApiResult<{ saved: true }>> {
    if (!isWriteSwitchOpen()) return apiError('BUSINESS_ERROR', '写开关已关闭。')
    await this.confirmAccountRead()
    return this.history.save(this.historyUserKey, 'file', { title, queryId, queryXml }, signal)
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

  /** 只读确认递交走新 CPC 还是旧页面，然后给出首页页签地址。不提交、不创建。 */
  resolveProcessForm(target: ProcessOpenTarget): Promise<ApiResult<string>> {
    return (async (): Promise<ApiResult<string>> => {
      let isNewCpc: boolean | null = null
      if (target.kind === 'EF' && filingNeedsCpcFlag(target.filingType)) {
        if (!(await this.confirmAccountRead())) {
          return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
        }
        const params = new URLSearchParams()
        params.set('Call', 'GetIsNewCPC')
        params.set('filing_id', target.id)
        params.set('log_pagename', 'ProcessNew.aspx')
        const response = await this.transport.post('getIsNewCpc', params)
        if (!response.ok) {
          if (response.error.code === 'SESSION_EXPIRED') this.session.expire()
          return response
        }
        const flag = readNewCpcFlag(response.data)
        if (flag === null) return apiError('INVALID_RESPONSE', '没有读到递交页面版本，不能打开。')
        isNewCpc = flag
      }
      const path = processFormPath(target, isNewCpc)
      if (!path) return apiError('INVALID_QUERY', '这条记录对不上原站的打开页面。')
      return { ok: true, data: path }
    })()
  }

  listMailProcesses(query: ProcessListQuery): Promise<ApiResult<ProcessListResult>> {
    return (async (): Promise<ApiResult<ProcessListResult>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const params = buildProcessListParams(query)
      if (!params.ok) return params
      const response = await this.transport.post(processOperation(query.kind), params.data)
      if (!response.ok && response.error.code === 'SESSION_EXPIRED') this.session.expire()
      return response.ok ? normalizeProcessList(response.data, query) : response
    })()
  }

  /** 发文页要求表原文。只认案件编号，不解释这些句子。 */
  readCaseDemands(caseId: string, signal?: AbortSignal): Promise<ApiResult<CaseDemandAsset>> {
    return (async (): Promise<ApiResult<CaseDemandAsset>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const result = await loadCaseDemandText(caseId, (params, next) => this.transport.post('caseDemand', params, next), signal)
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') this.session.expire()
      return result
    })()
  }

  /** 案件查询按我方文号找案子，再读这条处理事项的发文流程。期限监控里结束的事项也能对上。 */
  lookupIcFlow(rows: IcFlowAsk[]): Promise<ApiResult<{ items: IcFlowHit[] }>> {
    return (async (): Promise<ApiResult<{ items: IcFlowHit[] }>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const result = await lookupIcFlow(rows, (operation, params) => this.transport.post(operation, params))
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') this.session.expire()
      return result
    })()
  }

  /** 案件页流程图。用来看这一件处理事项的发文是待审核还是已经结束。 */
  readCaseBusFlow(caseId: string, procId: string, signal?: AbortSignal): Promise<ApiResult<{ gate: PctSendGate }>> {
    return (async (): Promise<ApiResult<{ gate: PctSendGate }>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const result = await loadPctSendGate(caseId, procId, (params, next) => this.transport.post('caseBusFlow', params, next), signal)
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') this.session.expire()
      return result
    })()
  }

  /** 客户资料页要求表。只认客户编号，不打开邮件页，也不改要求。 */
  readCustomerDemands(customerId: string, signal?: AbortSignal): Promise<ApiResult<CustomerDemandAsset>> {
    return this.readCustomerPage(customerId, (params, next) => this.transport.post('customerPageDemand', params, next), loadCustomerDemands, signal)
  }

  /** 客户资料页联系人。用来把表格称呼对上邮箱，不读取电话和地址。 */
  readCustomerDirectory(customerId: string, signal?: AbortSignal): Promise<ApiResult<CustomerDirectoryAsset>> {
    return this.readCustomerPage(customerId, (params, next) => this.transport.post('customerPageContact', params, next), loadCustomerDirectory, signal)
  }

  private readCustomerPage<T>(
    customerId: string,
    post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>,
    load: (customerId: string, post: (params: URLSearchParams, signal?: AbortSignal) => Promise<ApiResult<unknown>>, signal?: AbortSignal) => Promise<ApiResult<T>>,
    signal?: AbortSignal
  ): Promise<ApiResult<T>> {
    return (async (): Promise<ApiResult<T>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const result = await load(customerId, post, signal)
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') this.session.expire()
      return result
    })()
  }

  /** 当前发文上已经填好的地址，以及这封信里的文号。 */
  readMailAddresses(mailId: string): Promise<ApiResult<{ to: string; cc: string; customerId: string; caseVolumes: string[] }>> {
    return (async (): Promise<ApiResult<{ to: string; cc: string; customerId: string; caseVolumes: string[] }>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      if (!isQueryGuid(mailId)) return apiError('INVALID_QUERY', '发文编号无效。')
      const params = new URLSearchParams()
      params.set('Call', 'GetMailInfo')
      params.set('mail_id', mailId)
      params.set('log_pagename', 'mail.aspx')
      const response = await this.transport.post('getMailInfo', params)
      if (!response.ok) {
        if (response.error.code === 'SESSION_EXPIRED') this.session.expire()
        return response
      }
      const row = readMailInfo(response.data, mailId)
      if (!row.ok) return apiError('INVALID_RESPONSE', row.message)
      const to = addressField(row.row, 'mail_to')
      const cc = addressField(row.row, 'mail_cc')
      if (to === null || cc === null) return apiError('INVALID_RESPONSE', '发文上的收件人或抄送这次没有读到。')
      const cases = await this.transport.post('getMailCase', listParams('GetMailCase', mailId, 1))
      if (!cases.ok) {
        if (cases.error.code === 'SESSION_EXPIRED') this.session.expire()
        return cases
      }
      const caseVolumes = volumesOnMail(cases.data)
      if (!caseVolumes) return apiError('INVALID_RESPONSE', '这封发文上的文号没有读全。')
      const customer = addressField(row.row, 'customer_id')
      return { ok: true, data: { to, cc, customerId: customer && isQueryGuid(customer) ? customer : '', caseVolumes } }
    })()
  }

  /** 发文页右侧联系人。最近联系人不需要发文编号，其余分组需要。 */
  readMailContacts(mailId: string, customerId: string, signal?: AbortSignal): Promise<ApiResult<MailContactAsset>> {
    return (async (): Promise<ApiResult<MailContactAsset>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const result = await loadMailContactText({ mailId, customerId }, (operation, params, next) => this.transport.post(operation, params, next), signal)
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') this.session.expire()
      return result
    })()
  }

  /** 审核人来自当前账号一封进行中发文的 GetFlowInfo + GetFlowSubmit。 */
  listFlowReviewers(): Promise<ApiResult<AccountReviewerList>> {
    return (async (): Promise<ApiResult<AccountReviewerList>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const query = { searchKey: '', pageIndex: 1, pageSize: 5 }
      const params = buildMailProcessParams(query)
      if (!params.ok) return params
      const listed = await this.transport.post('mailProcess', params.data)
      if (!listed.ok) {
        if (listed.error.code === 'SESSION_EXPIRED') this.session.expire()
        return listed
      }
      const processes = normalizeMailProcess(listed.data, query)
      if (!processes.ok) return processes
      const mail = processes.data.items.find(item => item.mailId)
      if (!mail) return { ok: true, data: { reviewers: [], message: '当前账号没有进行中的发文，读不到审核人。' } }
      const reader = new WorkflowReadService(this.transport)
      const info = await reader.reloadInfo(mail.mailId, 'CO')
      if (!info.ok) return apiError('BUSINESS_ERROR', info.message)
      const nodes = await reader.nodes(info.info)
      if (nodes.nodes.length === 0) return apiError('BUSINESS_ERROR', nodes.message || '没有读到下一节点。')
      const reviewers: AccountReviewerList['reviewers'] = []
      const seen = new Set<string>()
      for (const node of nodes.nodes) {
        if (node.nodeCode === 'END') continue
        for (const reviewer of node.reviewers) {
          const key = reviewer.id.toLowerCase()
          if (!reviewer.name.trim() || seen.has(key)) continue
          seen.add(key)
          reviewers.push({ id: reviewer.id, name: reviewer.name })
        }
      }
      return {
        ok: true,
        data: {
          reviewers,
          message: reviewers.length ? '' : '下一节点没有带姓名的审核人。'
        }
      }
    })()
  }

  exportCaseContacts(volumes: string[]): Promise<ApiResult<CaseContactExport>> {
    return (async (): Promise<ApiResult<CaseContactExport>> => {
      if (trustedOrigin(this.pageOrigin) !== PCL_ORIGIN) {
        return apiError('INVALID_ORIGIN', `案件联系人只能在${CASE_CONTACT_CUSTOMER_NAME}的 EASY 上读取。`)
      }
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const session = await this.checkSession()
      if (!session.ok || session.data.status !== 'authenticated' || !session.data.userId) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const result = await loadCaseContacts(this.transport, session.data.userId, volumes)
      if (!result.ok && result.error.code === 'SESSION_EXPIRED') {
        const again = await this.checkSession()
        if (again.ok && again.data.status === 'authenticated') {
          return apiError('BUSINESS_ERROR', `当前账号已登录。案件查询没有被原网站接受，请刷新${CASE_CONTACT_CUSTOMER_NAME}页面后再试一次。`)
        }
        this.session.expire()
      }
      return result
    })()
  }

  searchLimitMonitor(query: LimitMonitorQuery): Promise<ApiResult<LimitMonitorResult>> {
    this.cancelLimitMonitor()
    const controller = new AbortController()
    this.limitController = controller
    const requestNumber = ++this.limitSequence
    return (async (): Promise<ApiResult<LimitMonitorResult>> => {
      if (!(await this.confirmAccountRead())) {
        return apiError('SESSION_EXPIRED', '请先在 EASY 原网站登录并检测登录状态。')
      }
      const params = buildLimitMonitorParams(query)
      if (!params.ok) return params
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

  submitLimitMails(userId: string, items: LimitMailSubmitItem[]): Promise<{ stopped: boolean; results: LimitMailSubmitResult[] }> {
    return submitLimitMailBatch(this.transport, userId, items)
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

function addressField(row: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return null
  const value = row[key]
  if (value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function volumesOnMail(data: unknown): string[] | null {
  if (!isRecord(data) || data.TableRows === null || !Array.isArray(data.TableRows)) return null
  const volumes: string[] = []
  for (const row of data.TableRows) {
    if (!isRecord(row)) return null
    const ours = typeof row.case_volume === 'string' ? row.case_volume.trim() : ''
    const theirs = typeof row.case_volume_customer === 'string' ? row.case_volume_customer.trim() : ''
    if (ours) volumes.push(ours)
    if (theirs) volumes.push(theirs)
  }
  const raw = data.TableRowsCount
  const total = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : data.TableRows.length
  if (total > data.TableRows.length) return null
  return volumes
}
