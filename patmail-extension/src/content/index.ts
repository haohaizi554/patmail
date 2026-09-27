import { isContentRequest, MessageType, type ContentResponse, type FileSearchFormField, type MessageBridge } from '../shared/message'
import { sendToBackground } from '../utils/runtime'
import { injectPanel } from './injector'
import { readPageInfo, scanPage } from './scanner'
import { EasyRuntime } from '../api/client'
import { scanFileSearchForm, warmFileSearchTrees } from '../query/scan-file-search-form.mjs'
import { LiveEasyAcceptanceRunner } from '../automation/acceptance-runner'

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

function scanThroughPageScript(doc: Document): Promise<FileSearchFormField[]> {
  const view = doc.defaultView
  if (!view) return Promise.resolve(scanFileSearchForm(doc).fields)
  const page = view
  const marker = `patmail-form-${Date.now()}`
  return new Promise(resolve => {
    const timer = page.setTimeout(() => {
      page.removeEventListener('message', onMessage)
      resolve(scanFileSearchForm(doc).fields)
    }, 70000)
    function onMessage(event: MessageEvent): void {
      if (event.origin !== page.location.origin || !event.data || event.data.marker !== marker || !Array.isArray(event.data.fields)) return
      page.clearTimeout(timer)
      page.removeEventListener('message', onMessage)
      resolve(event.data.fields as FileSearchFormField[])
    }
    view.addEventListener('message', onMessage)
    const script = doc.createElement('script')
    script.textContent = `(async function () {
      const warm = ${warmFileSearchTrees.toString()};
      const scan = ${scanFileSearchForm.toString()};
      try {
        await warm(document);
        window.postMessage({ marker: ${JSON.stringify(marker)}, fields: scan(document).fields }, location.origin);
      } catch (error) {
        window.postMessage({ marker: ${JSON.stringify(marker)}, fields: [] }, location.origin);
      }
    })()`
    doc.documentElement.appendChild(script)
    script.remove()
  })
}

async function scanDocument(doc: Document): Promise<FileSearchFormField[]> {
  await waitForCaseTypes(doc)
  const view = doc.defaultView as (Window & { jQuery?: unknown }) | null
  if (view?.jQuery) {
    await warmFileSearchTrees(doc)
    return scanFileSearchForm(doc).fields
  }
  return scanThroughPageScript(doc)
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
      case MessageType.ListHistoryQueries:
        return { type: MessageType.HistoryQueriesResult,
          payload: await easyRuntime.listHistoryQueries(message.payload.force, signal, message.payload.surface ?? 'file') }
      case MessageType.GetHistoryQuery:
        return { type: MessageType.HistoryQueryResult,
          payload: await easyRuntime.getHistoryQuery(message.payload.queryId, signal, message.payload.surface ?? 'file') }
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

