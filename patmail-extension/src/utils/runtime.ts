import { isMessage, MessageType, type BackgroundRequest, type BackgroundResponse } from '../shared/message'

/** 扩展重新加载或后台不可用时返回 null，读取 lastError 避免浏览器产生未处理错误。 */
export function sendToBackground(message: BackgroundRequest, timeoutMs = 5_000): Promise<BackgroundResponse | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    const finish = (result: BackgroundResponse | null) => {
      clearTimeout(timer)
      resolve(result)
    }
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError || !isMessage(response)) {
          finish(null)
          return
        }
        const accepted = response.type === MessageType.Pong || response.type === MessageType.Error ||
          response.type === MessageType.ExecutionLease || response.type === MessageType.ExecutionRecovered ||
          response.type === MessageType.TaskResult || response.type === MessageType.AcceptanceResult ||
          response.type === MessageType.EvidenceResult || response.type === MessageType.WorkspaceResult
        if (!accepted) {
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

