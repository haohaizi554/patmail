import { isRecord } from '../shared/guards'
import { isMessage, MessageType, type BackgroundRequest, type BackgroundResponse } from '../shared/message'

function failure(message: string): BackgroundResponse {
  return { type: MessageType.Error, payload: { message } }
}

const CALL_CHANNEL = 'patmail-call'
const RESULT_CHANNEL = 'patmail-result'

function acceptedBackground(response: unknown): response is BackgroundResponse {
  return isMessage(response) && (
    response.type === MessageType.Pong || response.type === MessageType.Error ||
    response.type === MessageType.ExecutionLease || response.type === MessageType.ExecutionRecovered ||
    response.type === MessageType.TaskResult || response.type === MessageType.AcceptanceResult ||
    response.type === MessageType.EvidenceResult || response.type === MessageType.WorkspaceResult ||
    response.type === MessageType.AgentChatResult
  )
}

function describeBackground(response: unknown, reason: string): BackgroundResponse {
  const nested = isRecord(response) && isRecord(response.payload) && typeof response.payload.message === 'string'
    ? response.payload.message : ''
  const type = isRecord(response) && typeof response.type === 'string' ? response.type : ''
  return failure(nested || (reason ? `扩展后台没有答上：${reason}` : '') || (type ? `扩展后台返回了无法识别的结果（${type}）。` : '扩展后台没有返回结果。'))
}

/** 正在等人选择时返回 true。这段时间不计入后台时限。 */
export interface BackgroundTimeoutHold {
  paused(): boolean
}

function sendThroughMessage(message: BackgroundRequest, timeoutMs: number, hold?: BackgroundTimeoutHold): Promise<BackgroundResponse | null> {
  return new Promise((resolve) => {
    let settled = false
    const requestId = globalThis.crypto.randomUUID()
    const started = Date.now()
    let pausedSince = 0
    let pausedMs = 0
    const finish = (result: BackgroundResponse | null) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      chrome.runtime.onMessage.removeListener(onResult)
      resolve(result)
    }
    const timer = setInterval(() => {
      const now = Date.now()
      if (hold?.paused()) {
        if (pausedSince === 0) pausedSince = now
        return
      }
      if (pausedSince !== 0) {
        pausedMs += now - pausedSince
        pausedSince = 0
      }
      if (now - started - pausedMs >= timeoutMs) finish(failure('扩展后台没有在时限内返回。'))
    }, 500)
    const onResult = (pushed: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || !isRecord(pushed) || pushed.channel !== RESULT_CHANNEL || pushed.id !== requestId) return
      if (acceptedBackground(pushed.body)) finish(pushed.body)
      else finish(describeBackground(pushed.body, ''))
    }
    chrome.runtime.onMessage.addListener(onResult)
    try {
      chrome.runtime.sendMessage({ channel: CALL_CHANNEL, id: requestId, message }, (response: unknown) => {
        const reason = chrome.runtime.lastError?.message ?? ''
        if (acceptedBackground(response)) finish(response)
        else if (reason) finish(describeBackground(response, reason))
      })
    } catch (error) {
      finish(failure(error instanceof Error ? error.message : '扩展后台无法接收消息。'))
    }
  })
}

/** 扩展重新加载或后台不可用时带回具体原因。消息口被嵌套调用关掉时，仍接收后台另送的结果。 */
export function sendToBackground(message: BackgroundRequest, timeoutMs = 5_000, hold?: BackgroundTimeoutHold): Promise<BackgroundResponse | null> {
  return sendThroughMessage(message, timeoutMs, hold)
}

