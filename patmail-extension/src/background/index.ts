import { indexedTransactionStore, ExecutionLedger } from '../automation/ledger'
import { IndexedTaskStore } from '../automation/indexed-store'
import { IndexedEvidenceStore, MemoryEvidenceStore } from '../automation/evidence-store'
import { handleAuthorityMessage } from './authority'
import { isMessage, MessageType, type BackgroundResponse } from '../shared/message'

const ownerId = globalThis.crypto.randomUUID()
const transactions = indexedTransactionStore()
const ledger = transactions ? new ExecutionLedger(transactions, ownerId) : null
const tasks = globalThis.indexedDB ? new IndexedTaskStore(globalThis.indexedDB) : null
const evidence = globalThis.indexedDB ? new IndexedEvidenceStore(globalThis.indexedDB) : new MemoryEvidenceStore()

/** MV3 Service Worker 是租约、任务和证据的唯一写入方。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isMessage(message)) return
  if (message.type === MessageType.Ping) {
    const response: BackgroundResponse = { type: MessageType.Pong, payload: { ok: true } }
    sendResponse(response)
    return
  }
  if (message.type === MessageType.RunReadonlyAcceptance) return
  void handleAuthorityMessage(message, { ledger, tasks, evidence }).then(response => {
    sendResponse(response ?? { type: MessageType.Error, payload: { message: '后台没有处理这条消息。' } })
  })
  return true
})
