import { ExecutionLedger, indexedTransactionStore } from '../automation/ledger'
import { isMessage, MessageType, type BackgroundResponse } from '../shared/message'

const ownerId = globalThis.crypto.randomUUID()
const transactions = indexedTransactionStore()
const ledger = transactions ? new ExecutionLedger(transactions, ownerId) : null

/** MV3 Service Worker 只处理扩展消息。租约写在 storage，不放在内存 Map。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isMessage(message)) return
  if (message.type === MessageType.Ping) {
    const response: BackgroundResponse = { type: MessageType.Pong, payload: { ok: true } }
    sendResponse(response)
    return
  }
  if (message.type === MessageType.ClaimExecution) {
    if (!ledger) {
      const response: BackgroundResponse = { type: MessageType.ExecutionLease, payload: { ok: false, reason: '执行记录存储不可用，不能领取。', lease: null } }
      sendResponse(response)
      return
    }
    void ledger.claim(message.payload.origin, message.payload.operatorId, message.payload.taskFingerprint).then(result => {
      const response: BackgroundResponse = {
        type: MessageType.ExecutionLease,
        payload: { ok: result.ok, reason: result.ok ? '' : result.reason, lease: result.lease }
      }
      sendResponse(response)
    })
    return true
  }
  if (message.type === MessageType.RecoverExecution) {
    if (!ledger) {
      const response: BackgroundResponse = { type: MessageType.ExecutionRecovered, payload: { leases: [] } }
      sendResponse(response)
      return
    }
    void ledger.recover(message.payload.origin, message.payload.operatorId).then(leases => {
      const response: BackgroundResponse = { type: MessageType.ExecutionRecovered, payload: { leases } }
      sendResponse(response)
    })
    return true
  }
})
