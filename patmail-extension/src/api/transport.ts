import { trustedOrigin } from './config'
import { apiError, type ApiResult } from './types'

export type EasyOperation =
  | 'session' | 'fileSearch' | 'historyQuery'
  | 'basicData' | 'flowDirection' | 'fileTypeTree' | 'fieldColumn' | 'listColumn' | 'mailType'
  | 'deptTree' | 'treeUser' | 'treeAgent' | 'fileTempList' | 'deptBranch' | 'applyTags' | 'limitInit' | 'limitCtrlProc'
  | 'mailCustomer' | 'mailInfoInit' | 'getMailInfo' | 'getMailFile' | 'getMailCase'
  | 'getMailRule' | 'getCustomerContact' | 'getRecentContact' | 'getCaseContact' | 'getSalesContact' | 'getPicsContact' | 'getCaseAgentContact' | 'getSignature' | 'getMailSet' | 'mailSignatureList' | 'signatureSet' | 'caseDemand' | 'saveMailInfo' | 'saveMailRelatedFiles'
  | 'getFlowInfo' | 'getFlowHistory' | 'getUrgencyList' | 'getFlowSubmit' | 'getFlowLastStatus'
  | 'limitMonitor' | 'mailProcess' | 'processAP' | 'processEF' | 'getIsNewCpc'

export interface TransportOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
}

const ROUTES: Record<EasyOperation, { path: string; call: string }> = {
  session: { path: '/AjaxServers/Login.ashx', call: 'GetUserModel' },
  fileSearch: { path: '/AjaxServers/CaseInfo.ashx', call: 'GetSearchFiles' },
  historyQuery: { path: '/AjaxServers/CaseInfo.ashx', call: 'SearchQueryHisList' },
  basicData: { path: '/AjaxServers/CaseInfo.ashx', call: 'IPGetBasicData' },
  flowDirection: { path: '/AjaxServers/CaseInfo.ashx', call: 'GetFlowdirection' },
  fileTypeTree: { path: '/AjaxServers/Common.ashx', call: 'LoadFileTypeByCaseType' },
  fieldColumn: { path: '/AjaxServers/PatentAction.ashx', call: 'GetFieldColumn' },
  listColumn: { path: '/AjaxServers/Common.ashx', call: 'LoadListColumn' },
  mailType: { path: '/AjaxServers/Common.ashx', call: 'LoadMailType' },
  deptTree: { path: '/AjaxServers/Common.ashx', call: 'LoadDeptTree' },
  treeUser: { path: '/AjaxServers/Common.ashx', call: 'GetTreeUser' },
  treeAgent: { path: '/AjaxServers/Common.ashx', call: 'GetTreeAgent' },
  fileTempList: { path: '/AjaxServers/BaseInfo.ashx', call: 'GetFileTempNameList' },
  deptBranch: { path: '/AjaxServers/BaseInfo.ashx', call: 'GetDeptBranch' },
  applyTags: { path: '/AjaxServers/CaseInfo.ashx', call: 'GetApplyTags' },
  limitInit: { path: '/AjaxServers/Report.ashx', call: 'LimitMonitorInit' },
  limitCtrlProc: { path: '/AjaxServers/Report.ashx', call: 'LimitMonitorGetCtrlproc' },
  mailCustomer: { path: '/AjaxServers/Notice.ashx', call: 'MailCustomer' },
  mailInfoInit: { path: '/AjaxServers/Mail.ashx', call: 'MailinfoInit' },
  getMailInfo: { path: '/AjaxServers/Mail.ashx', call: 'GetMailInfo' },
  getMailFile: { path: '/AjaxServers/Mail.ashx', call: 'GetMailFile' },
  getMailCase: { path: '/AjaxServers/Mail.ashx', call: 'GetMailCase' },
  getMailRule: { path: '/AjaxServers/Mail.ashx', call: 'GetMailRule' },
  getCustomerContact: { path: '/AjaxServers/Mail.ashx', call: 'GetCustomerContact' },
  getRecentContact: { path: '/AjaxServers/Mail.ashx', call: 'GetRecentContact' },
  getCaseContact: { path: '/AjaxServers/Mail.ashx', call: 'GetCaseContact' },
  getSalesContact: { path: '/AjaxServers/Mail.ashx', call: 'GetSalesContact' },
  getPicsContact: { path: '/AjaxServers/Mail.ashx', call: 'GetPicsContact' },
  getCaseAgentContact: { path: '/AjaxServers/Mail.ashx', call: 'GetCaseAgentContact' },
  caseDemand: { path: '/AjaxServers/PatentAction.ashx', call: 'GetDemandBuCaseid' },
  getSignature: { path: '/AjaxServers/Mail.ashx', call: 'GetSignature' },
  getMailSet: { path: '/AjaxServers/Login.ashx', call: 'Getmailset' },
  mailSignatureList: { path: '/AjaxServers/Login.ashx', call: 'GetMailSignatureSettingList' },
  signatureSet: { path: '/AjaxServers/Login.ashx', call: 'GetSignatureset' },
  saveMailInfo: { path: '/AjaxServers/Mail.ashx', call: 'SaveMailInfo' },
  saveMailRelatedFiles: { path: '/AjaxServers/Mail.ashx', call: 'SaveMailRalteCaseFile' },
  getFlowInfo: { path: '/AjaxServers/Common.ashx', call: 'GetFlowInfo' },
  getFlowHistory: { path: '/AjaxServers/Common.ashx', call: 'GetFlowHistory' },
  getUrgencyList: { path: '/AjaxServers/Common.ashx', call: 'GetUrgencyList' },
  getFlowSubmit: { path: '/AjaxServers/Common.ashx', call: 'GetFlowSubmit' },
  getFlowLastStatus: { path: '/AjaxServers/Common.ashx', call: 'GetFlowLastStatus' },
  limitMonitor: { path: '/AjaxServers/Report.ashx', call: 'GetLimitMonitorCaseList' },
  mailProcess: { path: '/AjaxServers/Common.ashx', call: 'GetProcessByTypeCO' },
  processAP: { path: '/AjaxServers/Common.ashx', call: 'GetProcessByTypeAP' },
  processEF: { path: '/AjaxServers/Common.ashx', call: 'GetProcessByTypeEF' },
  getIsNewCpc: { path: '/AjaxServers/CaseInfo.ashx', call: 'GetIsNewCPC' }
}

function loginRedirect(response: Response, origin: string): boolean {
  if (!response.url) return false
  try {
    const finalUrl = new URL(response.url)
    return finalUrl.origin === origin && /\blogin(?:\.aspx)?$/i.test(finalUrl.pathname)
  } catch {
    return false
  }
}

function looksLikeLoginHtml(body: string): boolean {
  return /<\s*(?:!doctype\s+html|html|form)\b/i.test(body.slice(0, 300)) &&
    /login|登录|type\s*=\s*["']?password/i.test(body.slice(0, 3000))
}

/** 无有效会话时，GetUserModel 返回短 HTML「出错了!」，不是登录页，也不是业务 JSON。 */
function looksLikeLoggedOutHtml(body: string): boolean {
  return looksLikeLoginHtml(body) || (body.length <= 500 && /出错了/.test(body) && !/<html[\s>]/i.test(body))
}

export class EasyTransport {
  private readonly origin: string | null
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number

  constructor(pageOrigin: string, options: TransportOptions = {}) {
    this.origin = trustedOrigin(pageOrigin)
    // 浏览器原生 fetch 是 WebIDL 方法，作为类字段调用会丢失 Window 接收者。
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  /** 只读请求遇到网关 502/503 时再试。写请求不重试，避免一次 502 后面又创建出第二封。 */
  async post(operation: EasyOperation, params: URLSearchParams, signal?: AbortSignal): Promise<ApiResult<unknown>> {
    const retryable = operation !== 'mailCustomer' && operation !== 'saveMailInfo' && operation !== 'saveMailRelatedFiles'
    let result = await this.postOnce(operation, params, signal)
    for (let attempt = 1; retryable && !result.ok && (result.error.status === 502 || result.error.status === 503) && attempt < 3; attempt += 1) {
      if (signal?.aborted) return apiError('REQUEST_ABORTED', '请求已取消。')
      await new Promise(resolve => setTimeout(resolve, 200 * attempt))
      if (signal?.aborted) return apiError('REQUEST_ABORTED', '请求已取消。')
      result = await this.postOnce(operation, params, signal)
    }
    return result
  }

  /** 文件查询和期限监控在这套原网站上经常超过 15 秒。测试传入的短超时仍然生效。 */
  private waitMs(operation: EasyOperation): number {
    if (this.timeoutMs < 15_000) return this.timeoutMs
    if (operation === 'fileSearch' || operation === 'limitMonitor' || operation === 'mailProcess' || operation === 'processAP' || operation === 'processEF') return 60_000
    return this.timeoutMs
  }

  /** Handler、Call、方法和目标 Origin 由内部白名单固定，页面消息不能提供 URL。 */
  private async postOnce(operation: EasyOperation, params: URLSearchParams, signal?: AbortSignal): Promise<ApiResult<unknown>> {
    if (!this.origin) return apiError('INVALID_ORIGIN', '当前页面不属于受信任的 EASY 站点。')
    const route = ROUTES[operation]
    if (!route || params.getAll('Call').length !== 1 || params.get('Call') !== route.call) {
      return apiError('INVALID_QUERY', '业务请求类型无效。')
    }
    if (signal?.aborted) return apiError('REQUEST_ABORTED', '请求已取消。')

    const controller = new AbortController()
    let timedOut = false
    const onExternalAbort = () => controller.abort()
    signal?.addEventListener('abort', onExternalAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.waitMs(operation))
    try {
      const response = await this.fetcher(this.origin + route.path, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'follow',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: params.toString(),
        signal: controller.signal
      })
      if (response.status === 401 || response.status === 403 || loginRedirect(response, this.origin)) {
        return apiError('SESSION_EXPIRED', 'EASY 登录状态已失效，请在原网站重新登录。', response.status)
      }
      if (!response.ok) {
        return apiError('HTTP_ERROR', response.status === 502 ? 'EASY 网关异常。' :
          response.status === 503 ? 'EASY 服务暂不可用。' : 'EASY 返回 HTTP 错误。', response.status)
      }
      const body = (await response.text()).trim()
      if (body.startsWith('<')) {
        return apiError(looksLikeLoggedOutHtml(body) ? 'SESSION_EXPIRED' : 'UNEXPECTED_HTML',
          looksLikeLoggedOutHtml(body) ? 'EASY 登录状态已失效，请在原网站重新登录。' : 'EASY 返回了非业务 HTML。')
      }
      try {
        return { ok: true, data: JSON.parse(body) as unknown }
      } catch {
        return apiError('INVALID_RESPONSE', 'EASY 响应不是有效 JSON。')
      }
    } catch {
      if (timedOut) return apiError('REQUEST_TIMEOUT', '请求超时，请重试。')
      if (signal?.aborted || controller.signal.aborted) return apiError('REQUEST_ABORTED', '请求已取消。')
      return apiError('NETWORK_ERROR', '无法连接 EASY，请检查网络。')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onExternalAbort)
    }
  }
}
