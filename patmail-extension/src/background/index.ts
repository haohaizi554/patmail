import { indexedTransactionStore, ExecutionLedger } from '../automation/ledger'
import { IndexedTaskStore } from '../automation/indexed-store'
import { IndexedEvidenceStore, MemoryEvidenceStore } from '../automation/evidence-store'
import { handleAuthorityMessage } from './authority'
import { scopeExtensionPageMessage } from './scope'
import { EasyConnectionController } from '../shared/connection'
import { handleWorkspaceMessage, openWorkspaceTab, type WorkspaceHost } from './workspace'
import { isMessage, MessageType, type AppMessage, type BackgroundResponse } from '../shared/message'

const ownerId = globalThis.crypto.randomUUID()
const transactions = indexedTransactionStore()
const ledger = transactions ? new ExecutionLedger(transactions, ownerId) : null
const tasks = globalThis.indexedDB ? new IndexedTaskStore(globalThis.indexedDB) : null
const evidence = globalThis.indexedDB ? new IndexedEvidenceStore(globalThis.indexedDB) : new MemoryEvidenceStore()
const connection = new EasyConnectionController()

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
  sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message)
}

chrome.tabs.onRemoved.addListener((tabId) => connection.detach(tabId))
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading') connection.observeNavigation(tabId, info.url ?? tab.url)
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
  let scoped: AppMessage = message
  if (fromExtensionPage(sender)) {
    const next = scopeExtensionPageMessage(message, connection.context)
    if ('error' in next) {
      sendResponse({ type: MessageType.Error, payload: { message: next.error } } satisfies BackgroundResponse)
      return
    }
    scoped = next
  }
  void handleAuthorityMessage(scoped, { ledger, tasks, evidence }).then(response => {
    sendResponse(response ?? { type: MessageType.Error, payload: { message: '后台没有处理这条消息。' } })
  })
  return true
})
