import { isMessage, MessageType, type BackgroundResponse } from '../shared/message'

/** MV3 Service Worker 只处理扩展消息，不访问 DOM，也不持久化页面表单。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isMessage(message) || message.type !== MessageType.Ping) return
  const response: BackgroundResponse = { type: MessageType.Pong, payload: { ok: true } }
  sendResponse(response)
})

