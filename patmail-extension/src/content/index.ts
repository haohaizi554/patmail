import { isContentRequest, MessageType, type ContentResponse, type MessageBridge } from '../shared/message'
import { sendToBackground } from '../utils/runtime'
import { injectPanel } from './injector'
import { readPageInfo, scanPage } from './scanner'
import { EasyRuntime } from '../api/client'

// API 请求始终由目标页面同源的 Content Script 发起，沿用浏览器已有会话。
const easyRuntime = new EasyRuntime(location.origin)

const bridge: MessageBridge = {
  async request(message): Promise<ContentResponse> {
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

