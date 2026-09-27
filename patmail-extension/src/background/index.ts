import { indexedTransactionStore, ExecutionLedger } from '../automation/ledger'
import { IndexedTaskStore } from '../automation/indexed-store'
import { IndexedEvidenceStore, MemoryEvidenceStore } from '../automation/evidence-store'
import { handleAuthorityMessage } from './authority'
import { scopeExtensionPageMessage } from './scope'
import { EasyConnectionController, sameConnectionSnapshot, type ConnectionSnapshot } from '../shared/connection'
import { handleWorkspaceMessage, openWorkspaceTab, recheckBoundSession, type WorkspaceHost } from './workspace'
import { isMessage, MessageType, type AppMessage, type BackgroundResponse } from '../shared/message'

const ownerId = globalThis.crypto.randomUUID()
const transactions = indexedTransactionStore()
const ledger = transactions ? new ExecutionLedger(transactions, ownerId) : null
const tasks = globalThis.indexedDB ? new IndexedTaskStore(globalThis.indexedDB) : null
const evidence = globalThis.indexedDB ? new IndexedEvidenceStore(globalThis.indexedDB) : new MemoryEvidenceStore()
const connection = new EasyConnectionController()
const CONNECTION_SNAPSHOT = 'patmail.connection.snapshot.v1'
let persistedSnapshot: ConnectionSnapshot | null = null

function persistConnection(): void {
  const next = connection.snapshot()
  if (sameConnectionSnapshot(persistedSnapshot, next)) return
  persistedSnapshot = next
  void chrome.storage.local.set({ [CONNECTION_SNAPSHOT]: next })
}

void chrome.storage.local.get(CONNECTION_SNAPSHOT).then(stored => {
  connection.restoreCandidate(stored[CONNECTION_SNAPSHOT])
  persistedSnapshot = connection.snapshot()
})

const host: WorkspaceHost = {
  connection,
  area: chrome.storage.local as unknown as WorkspaceHost['area'],
  tasks,
  evidence,
  queryTabs: () => chrome.tabs.query({}),
  getTab: (tabId) => chrome.tabs.get(tabId),
  createTab: async (url) => { await chrome.tabs.create({ url, active: true }) },
  focusTab: async (tabId, windowId) => {
    await chrome.tabs.update(tabId, { active: true })
    if (windowId != null) await chrome.windows.update(windowId, { focused: true })
  },
  openApp: async () => {
    const appUrl = chrome.runtime.getURL('app.html')
    const tabs = await chrome.tabs.query({})
    return openWorkspaceTab(tabs, appUrl, host.focusTab, async () => {
      const created = await chrome.tabs.create({ url: appUrl, active: true })
      if (created.id == null) throw new Error('没有打开工作台。')
      return created.id
    })
  },
  sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  persist: persistConnection
}

chrome.tabs.onRemoved.addListener((tabId) => {
  connection.detach(tabId)
  persistConnection()
})
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading') {
    connection.observeNavigation(tabId, info.url ?? tab.url)
    persistConnection()
  }
})
chrome.action.onClicked.addListener(() => { void host.openApp() })

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''))
}

/** MV3 Service Worker 是租约、任务和证据的唯一写入方。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isMessage(message)) return
  if (message.type === MessageType.Ping) {
    const response: BackgroundResponse = { type: MessageType.Pong, payload: { ok: true } }
    sendResponse(response)
    return
  }
  if (message.type === MessageType.RunReadonlyAcceptance) return
  if (message.type === MessageType.Workspace) {
    void handleWorkspaceMessage(message, host).then(sendResponse)
    return true
  }
  const writes = new Set<string>([
    MessageType.SaveTask, MessageType.ClaimExecution, MessageType.MarkExecutionPrepared,
    MessageType.MarkExecutionSent, MessageType.MarkExecutionResponse, MessageType.MarkExecutionVerified,
    MessageType.CompleteExecution, MessageType.ReleaseExecution, MessageType.MarkExecutionUnknown
  ])
  const reads = new Set<string>([
    MessageType.ListTasks, MessageType.GetTask, MessageType.ListAcceptance,
    MessageType.ArchiveTask, MessageType.ValidateTaskMetadata, MessageType.RecoverExecution
  ])
  void (async () => {
    let scoped: AppMessage = message
    if (fromExtensionPage(sender) && (writes.has(message.type) || reads.has(message.type))) {
      const gate = await recheckBoundSession(host)
      if (writes.has(message.type) && gate !== 'same') {
        sendResponse({ type: MessageType.Error, payload: { message: '会话已变化，请重新读取后再保存。' } } satisfies BackgroundResponse)
        return
      }
    }
    if (fromExtensionPage(sender)) {
      const next = scopeExtensionPageMessage(message, connection.context)
      if ('error' in next) {
        sendResponse({ type: MessageType.Error, payload: { message: next.error } } satisfies BackgroundResponse)
        return
      }
      scoped = next
    }
    const response = await handleAuthorityMessage(scoped, {
      ledger,
      tasks,
      evidence,
      account: {
        easyOrigin: connection.context.easyOrigin,
        operatorId: connection.context.operatorId,
        ...(connection.context.easyTabId == null ? {} : { easyTabId: connection.context.easyTabId, connectionVersion: connection.context.connectionVersion })
      }
    })
    sendResponse(response ?? { type: MessageType.Error, payload: { message: '后台没有处理这条消息。' } })
  })()
  return true
})
