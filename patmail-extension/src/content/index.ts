import { isContentRequest, MessageType, type ContentResponse, type MessageBridge } from '../shared/message'
import { sendToBackground } from '../utils/runtime'
import { injectPanel } from './injector'
import { readPageInfo, scanPage } from './scanner'
import { EasyRuntime } from '../api/client'
import { LiveEasyAcceptanceRunner } from '../automation/acceptance-runner'

// API 请求始终由目标页面同源的 Content Script 发起，沿用浏览器已有会话。
const easyRuntime = new EasyRuntime(location.origin)

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
      case MessageType.ListHistoryQueries:
        return { type: MessageType.HistoryQueriesResult,
          payload: await easyRuntime.listHistoryQueries(message.payload.force, signal) }
      case MessageType.GetHistoryQuery:
        return { type: MessageType.HistoryQueryResult,
          payload: await easyRuntime.getHistoryQuery(message.payload.queryId, signal) }
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
        const runner = new LiveEasyAcceptanceRunner({
          kind: 'live',
          call: () => easyRuntime.probeReadonly(message.payload.call)
        })
        const row = await runner.run({
          origin: location.origin,
          operatorId: '',
          call: message.payload.call,
          expected: message.payload.expected
        })
        return { type: MessageType.AcceptanceResult, payload: { records: [row as unknown as Record<string, unknown>] } }
      }
      case MessageType.CancelFileSearch:
        easyRuntime.cancelFileSearch()
        return { type: MessageType.FileSearchCancelled, payload: { ok: true } }
    }
  }
}

// Popup 发给当前顶层页面；返回 true 保持异步响应通道存活。
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isContentRequest(message)) return
  void bridge.request(message).then(sendResponse).catch(() => {
    sendResponse({ type: MessageType.Error, payload: { message: '页面读取失败，请刷新后重试。' } } satisfies ContentResponse)
  })
  return true
})

// 旧站点在 document_idle 附近使用 document.write 时，DOM 根节点可能短暂不可用。
let injectionAttempts = 0
function mountWhenReady(): void {
  try {
    injectPanel(bridge)
  } catch (error) {
    injectionAttempts++
    if (injectionAttempts < 5) window.setTimeout(mountWhenReady, 250)
    else console.error('PatMail initial injection failed', error)
  }
}
mountWhenReady()

