import { isMessage, MessageType, type BackgroundRequest, type BackgroundResponse } from '../shared/message'

/** 扩展重新加载或后台不可用时返回 null，读取 lastError 避免浏览器产生未处理错误。 */
export function sendToBackground(message: BackgroundRequest): Promise<BackgroundResponse | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5_000)
    const finish = (result: BackgroundResponse | null) => {
      clearTimeout(timer)
      resolve(result)
    }
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError || !isMessage(response) ||
          (response.type !== MessageType.Pong && response.type !== MessageType.Error)) {
          finish(null)
          return
        }
        finish(response)
      })
    } catch {
      finish(null)
    }
  })
}

