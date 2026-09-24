import { isContentRequest, MessageType, type ContentResponse, type MessageBridge } from '../shared/message'
import { sendToBackground } from '../utils/runtime'
import { injectPanel } from './injector'
import { readPageInfo, scanPage } from './scanner'

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

try {
  injectPanel(bridge)
} catch (error) {
  console.error('PatMail initial injection failed', error)
}

