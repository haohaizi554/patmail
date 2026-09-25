import { browserLock, ExecutionCoordinator, processLocalLock } from '../automation/coordinator'
import { isMessage, MessageType, type BackgroundResponse } from '../shared/message'

const ownerId = globalThis.crypto.randomUUID()
const area = {
  get: (key: string) => chrome.storage.local.get(key) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => chrome.storage.local.set(items)
}
const coordinator = new ExecutionCoordinator(area, browserLock() ?? processLocalLock(), ownerId)

/** MV3 Service Worker 只处理扩展消息。租约写在 storage，不放在内存 Map。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isMessage(message)) return
  if (message.type === MessageType.Ping) {
    const response: BackgroundResponse = { type: MessageType.Pong, payload: { ok: true } }
    sendResponse(response)
    return
  }
  if (message.type === MessageType.ClaimExecution) {
    void coordinator.claim(message.payload.origin, message.payload.operatorId, message.payload.taskFingerprint).then(result => {
      const response: BackgroundResponse = {
        type: MessageType.ExecutionLease,
        payload: { ok: result.ok, reason: result.ok ? '' : result.reason, lease: result.lease }
      }
      sendResponse(response)
    })
    return true
  }
  if (message.type === MessageType.RecoverExecution) {
    void coordinator.recover(message.payload.origin, message.payload.operatorId).then(leases => {
      const response: BackgroundResponse = { type: MessageType.ExecutionRecovered, payload: { leases } }
      sendResponse(response)
    })
    return true
  }
})
