import { isContentRequest, MessageType, type ContentResponse, type FileSearchFormField, type MessageBridge } from '../shared/message'
import type { ProcessOpenTarget } from '../api/mail-process'
import { sendToBackground } from '../utils/runtime'
import { injectPanel } from './injector'
import { readPageInfo, scanPage } from './scanner'
import { EasyRuntime } from '../api/client'
import { scanFileSearchForm } from '../query/scan-file-search-form.mjs'
import { LiveEasyAcceptanceRunner } from '../automation/acceptance-runner'
import { hydrateWriteSwitch, watchWriteSwitch } from '../settings/write-switch'

watchWriteSwitch()
void hydrateWriteSwitch()

// API 请求始终由目标页面同源的 Content Script 发起，沿用浏览器已有会话。
const easyRuntime = new EasyRuntime(location.origin)

function hasSearchTable(doc: Document): boolean {
  return Boolean(doc.querySelector('#table_element'))
}

async function waitForCaseTypes(doc: Document): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 8000) {
    const select = doc.querySelector('#case_type')
    if (select && select.querySelectorAll('option').length > 1) return
    await new Promise(resolve => window.setTimeout(resolve, 300))
  }
}

async function scanDocument(doc: Document): Promise<FileSearchFormField[]> {
  await waitForCaseTypes(doc)
  return scanFileSearchForm(doc).fields
}

function openEasyTab(tabId: string, title: string, path: string): Promise<{ ok: boolean; message: string }> {
  const marker = `patmail-open-${Date.now()}`
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve({ ok: false, message: '原网站没有接住打开请求。请回到 EASY 首页后再试。' })
    }, 4000)
    function onMessage(event: MessageEvent): void {
      if (event.source !== window || event.origin !== location.origin) return
      const data = event.data as { marker?: string; ok?: boolean; message?: string } | null
      if (!data || data.marker !== marker) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve({
        ok: data.ok === true,
        message: typeof data.message === 'string' ? data.message.slice(0, 200) : ''
      })
    }
    window.addEventListener('message', onMessage)
    const script = document.createElement('script')
    script.textContent = `(() => {
      const path = ${JSON.stringify(path)};
      const marker = ${JSON.stringify(marker)};
      const report = (ok, message) => window.postMessage({ marker, ok, message }, location.origin);
      const open = window.AddBusinessTab;
      if (typeof open !== 'function') {
        report(false, '当前标签不是 EASY 首页，打不开内部页签。请先回到首页。');
        return;
      }
      const bare = path.indexOf('?') > -1 ? path.slice(0, path.indexOf('?')) : path;
      const menu = window._UserMenu;
      let allowed = bare.toLowerCase().indexOf('forms/faq') >= 0;
      if (!allowed && Array.isArray(menu)) {
        for (let i = 0; i < menu.length; i++) {
          const node = menu[i] || {};
          if ((node.is_business || node.is_page) && String(node.menu_url || '').toLowerCase() === bare.toLowerCase()) {
            allowed = true;
            break;
          }
        }
      }
      if (!allowed) {
        report(false, '原网站菜单里没有这个页面，不能打开。');
        return;
      }
      open(${JSON.stringify(tabId)}, ${JSON.stringify(title)}, path);
      report(true, '已在 EASY 首页打开。');
    })()`
    document.documentElement.appendChild(script)
    script.remove()
  })
}

async function openProcessForm(target: ProcessOpenTarget): Promise<{ ok: boolean; message: string }> {
  const resolved = await easyRuntime.resolveProcessForm(target)
  if (!resolved.ok) return { ok: false, message: resolved.error.message.slice(0, 200) }
  return openEasyTab(`f_${target.id}`, target.title, resolved.data)
}

async function readFileSearchForm(): Promise<FileSearchFormField[]> {
  if (hasSearchTable(document)) return scanDocument(document)
  const frame = document.querySelector('iframe#mframe')
  if (frame instanceof HTMLIFrameElement) {
    const current = frame.contentDocument
    if (!current || !hasSearchTable(current)) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('文件查询页没有打开')), 20000)
        frame.addEventListener('load', () => { window.clearTimeout(timer); resolve() }, { once: true })
        frame.src = '/Forms/Patent/FileSearch.aspx'
      })
    }
    const doc = frame.contentDocument
    if (doc && hasSearchTable(doc)) return scanDocument(doc)
  }
  return scanFileSearchForm(document).fields
}

const bridge: MessageBridge = {
  async request(message, signal): Promise<ContentResponse> {
    switch (message.type) {
      case MessageType.ScanPage:
        return { type: MessageType.ScanResult, payload: scanPage(document) }
      case MessageType.GetPageInfo:
        return { type: MessageType.PageInfo, payload: readPageInfo(document) }
      case MessageType.ShowPanel:
        injectPanel(bridge)
        return { type: MessageType.PanelShown, payload: { ok: true } }
      case MessageType.Ping:
        return await sendToBackground(message) ?? {
          type: MessageType.Error, payload: { message: '后台连接已失效，请刷新网页。' }
        }
      case MessageType.CheckSession:
        return { type: MessageType.SessionResult, payload: await easyRuntime.checkSession() }
      case MessageType.CancelSessionCheck:
        easyRuntime.cancelSessionCheck()
        return { type: MessageType.SessionCheckCancelled, payload: { ok: true } }
      case MessageType.SearchFiles:
        return { type: MessageType.SearchFilesResult,
          payload: await easyRuntime.searchFiles(message.payload.query) }
      case MessageType.SearchLimitMonitor:
        return { type: MessageType.SearchLimitMonitorResult,
          payload: await easyRuntime.searchLimitMonitor(message.payload.query) }
      case MessageType.SubmitLimitMail:
        return { type: MessageType.SubmitLimitMailResult,
          payload: await easyRuntime.submitLimitMails(message.payload.userId, message.payload.items) }
      case MessageType.ExportCaseContacts:
        return { type: MessageType.ExportCaseContactsResult,
          payload: await easyRuntime.exportCaseContacts(message.payload.volumes) }
      case MessageType.ListMailProcesses:
        return { type: MessageType.ListMailProcessesResult,
          payload: await easyRuntime.listMailProcesses(message.payload.query) }
      case MessageType.OpenEasyForm:
        return { type: MessageType.OpenEasyFormResult, payload: await openProcessForm(message.payload.target) }
      case MessageType.ListFlowReviewers:
        return { type: MessageType.ListFlowReviewersResult,
          payload: await easyRuntime.listFlowReviewers() }
      case MessageType.ReadCaseDemands:
        return { type: MessageType.CaseDemandResult,
          payload: await easyRuntime.readCaseDemands(message.payload.caseId, signal) }
      case MessageType.ReadCaseBusFlow:
        return { type: MessageType.CaseBusFlowResult,
          payload: await easyRuntime.readCaseBusFlow(message.payload.caseId, message.payload.procId, signal) }
      case MessageType.LookupIcFlow:
        return { type: MessageType.LookupIcFlowResult,
          payload: await easyRuntime.lookupIcFlow(message.payload.rows) }
      case MessageType.ReadCustomerDemands:
        return { type: MessageType.CustomerDemandResult,
          payload: await easyRuntime.readCustomerDemands(message.payload.customerId, signal) }
      case MessageType.ReadCustomerDirectory:
        return { type: MessageType.CustomerDirectoryResult,
          payload: await easyRuntime.readCustomerDirectory(message.payload.customerId, signal) }
      case MessageType.ReadMailContacts:
        return { type: MessageType.MailContactResult,
          payload: await easyRuntime.readMailContacts(message.payload.mailId, message.payload.customerId, signal) }
      case MessageType.ReadMailAddresses:
        return { type: MessageType.MailAddressResult,
          payload: await easyRuntime.readMailAddresses(message.payload.mailId) }
      case MessageType.ListHistoryQueries:
        return { type: MessageType.HistoryQueriesResult,
          payload: await easyRuntime.listHistoryQueries(message.payload.force, signal, message.payload.surface ?? 'file') }
      case MessageType.GetHistoryQuery:
        return { type: MessageType.HistoryQueryResult,
          payload: await easyRuntime.getHistoryQuery(message.payload.queryId, signal, message.payload.surface ?? 'file') }
      case MessageType.SaveHistoryQuery:
        return { type: MessageType.HistoryQuerySaved,
          payload: await easyRuntime.saveHistoryQuery(message.payload.title, message.payload.queryId, message.payload.queryXml, signal) }
      case MessageType.ScanFileSearchForm:
        return { type: MessageType.FileSearchFormResult, payload: { fields: await readFileSearchForm() } }
      case MessageType.LoadDictionary:
        return { type: MessageType.DictionaryResult,
          payload: await easyRuntime.loadDictionary(message.payload, signal) }
      case MessageType.CreateEasyMail:
        return { type: MessageType.MailExecutionResult, payload: {
          view: message.payload.confirmed ? await easyRuntime.createEasyMail(message.payload.preview, message.payload.selection) : null
        } }
      case MessageType.SaveEasyMail:
        return { type: MessageType.MailExecutionResult, payload: {
          view: message.payload.confirmed ? await easyRuntime.saveEasyMail(message.payload.executionId, message.payload.preview, message.payload.selection, message.payload.acknowledgedDigest) : null
        } }
      case MessageType.FindMailExecution:
        return { type: MessageType.MailExecutionResult, payload: { view: await easyRuntime.findMailExecution(message.payload.fingerprint) } }
      case MessageType.InspectEasyMail:
        return { type: MessageType.MailExecutionResult, payload: { view: await easyRuntime.inspectEasyMail(message.payload.executionId) } }
      case MessageType.ReadWorkflow:
        return { type: MessageType.WorkflowResult, payload: { view: await easyRuntime.readWorkflow(message.payload.mailId, message.payload.flowType) } }
      case MessageType.RefreshWorkflow:
        return { type: MessageType.WorkflowResult, payload: { view: await easyRuntime.refreshWorkflow(message.payload.executionId) } }
      case MessageType.PreviewWorkflow:
        return { type: MessageType.WorkflowResult, payload: { view: await easyRuntime.previewWorkflow(message.payload.executionId, message.payload) } }
      case MessageType.RestoreWorkflow:
        return { type: MessageType.WorkflowResult, payload: { view: await easyRuntime.restoreWorkflow(message.payload.mailId) } }
      case MessageType.DiagnoseExistingMail:
        return { type: MessageType.ExistingMailDiagnostic, payload: await easyRuntime.diagnoseExistingMail(message.payload.mailId, message.payload.flowType) }
      case MessageType.RunReadonlyAcceptance: {
        const probe = await easyRuntime.probeReadonly(message.payload.call, {
          caseTypeId: message.payload.caseTypeId,
          mailId: message.payload.mailId,
          flowType: message.payload.flowType
        })
        const runner = new LiveEasyAcceptanceRunner({ kind: 'live', call: async () => probe })
        const row = await runner.run({
          origin: location.origin,
          operatorId: '',
          call: message.payload.call,
          expected: message.payload.expected
        })
        return { type: MessageType.AcceptanceResult, payload: { records: [row as unknown as Record<string, unknown>], probe } }
      }
      case MessageType.CancelFileSearch:
        easyRuntime.cancelFileSearch()
        return { type: MessageType.FileSearchCancelled, payload: { ok: true } }
    }
  }
}

// Popup 发给当前顶层页面；返回 true 保持异步响应通道存活。
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return
  if (!isContentRequest(message)) {
    const type = message && typeof message === 'object' && 'type' in message ? String((message as { type?: unknown }).type) : '未知'
    sendResponse({ type: MessageType.Error, payload: { message: `当前 EASY 页面脚本不认识 ${type}。请刷新这个 EASY 标签页。` } } satisfies ContentResponse)
    return
  }
  void bridge.request(message).then(sendResponse).catch(() => {
    sendResponse({ type: MessageType.Error, payload: { message: '页面读取失败，请刷新后重试。' } } satisfies ContentResponse)
  })
  return true
})

// 正式入口是完整工作台。浮窗只在收到 SHOW_PANEL 时挂载。

