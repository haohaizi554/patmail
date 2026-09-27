import { indexedTransactionStore, ExecutionLedger } from '../automation/ledger'
import { IndexedTaskStore } from '../automation/indexed-store'
import { IndexedEvidenceStore, MemoryEvidenceStore } from '../automation/evidence-store'
import { handleAuthorityMessage } from './authority'
import { scopeExtensionPageMessage } from './scope'
import { EasyConnectionController, sameConnectionSnapshot, type ConnectionSnapshot } from '../shared/connection'
import { handleWorkspaceMessage, openWorkspaceTab, recheckBoundSession, type WorkspaceHost } from './workspace'
import { isRecord } from '../shared/guards'
import { isMessage, MessageType, type AppMessage, type BackgroundResponse } from '../shared/message'

const CALL_CHANNEL = 'patmail-call'
const RESULT_CHANNEL = 'patmail-result'

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
let sessionReadTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSessionRead(tabId: number): void {
  if (sessionReadTimer != null) clearTimeout(sessionReadTimer)
  sessionReadTimer = setTimeout(() => {
    sessionReadTimer = undefined
    if (connection.context.easyTabId !== tabId || connection.context.sessionStatus === 'authenticated') return
    void recheckBoundSession(host).finally(() => persistConnection())
  }, 400)
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading') {
    connection.observeNavigation(tabId, info.url ?? tab.url)
    persistConnection()
  }
  if (connection.context.easyTabId === tabId && connection.context.sessionStatus === 'pending') {
    scheduleSessionRead(tabId)
  }
})
chrome.action.onClicked.addListener(() => { void host.openApp() })

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''))
}

const WRITES = new Set<string>([
  MessageType.SaveTask, MessageType.ClaimExecution, MessageType.MarkExecutionPrepared,
  MessageType.MarkExecutionSent, MessageType.MarkExecutionResponse, MessageType.MarkExecutionVerified,
  MessageType.CompleteExecution, MessageType.ReleaseExecution, MessageType.MarkExecutionUnknown
])
const READS = new Set<string>([
  MessageType.ListTasks, MessageType.GetTask, MessageType.ListAcceptance,
  MessageType.ArchiveTask, MessageType.ValidateTaskMetadata, MessageType.RecoverExecution
])

/** 页面和后台用长连接。查询过程中还会调用 EASY 页面，不能占用一次性消息口。 */
async function dispatchExtensionMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  if (!isMessage(message)) {
    const type = message && typeof message === 'object' && 'type' in message ? String((message as { type?: unknown }).type) : '未知'
    const inner = message && typeof message === 'object' && 'payload' in message
      && (message as { payload?: { action?: unknown; message?: { type?: unknown } } }).payload?.action === 'forward'
      ? String((message as { payload?: { message?: { type?: unknown } } }).payload?.message?.type ?? '')
      : ''
    return { type: MessageType.Error, payload: { message: `后台没有接住${inner ? `转发 ${inner}` : type}。请在扩展管理页重新加载后再试。` } }
  }
  if (message.type === MessageType.Ping) return { type: MessageType.Pong, payload: { ok: true } }
  if (message.type === MessageType.RunReadonlyAcceptance) {
    return { type: MessageType.Error, payload: { message: '后台没有处理这条消息。' } }
  }
  if (message.type === MessageType.Workspace) {
    try {
      return await handleWorkspaceMessage(message, host)
    } catch (error: unknown) {
      return { type: MessageType.Error, payload: { message: error instanceof Error ? error.message : '后台没有完成转发。' } }
    }
  }
  let scoped: AppMessage = message
  if (fromExtensionPage(sender) && (WRITES.has(message.type) || READS.has(message.type))) {
    const gate = await recheckBoundSession(host)
    if (WRITES.has(message.type) && gate !== 'same') {
      return { type: MessageType.Error, payload: { message: '会话已变化，请重新读取后再保存。' } }
    }
  }
  if (fromExtensionPage(sender)) {
    const next = scopeExtensionPageMessage(message, connection.context)
    if ('error' in next) return { type: MessageType.Error, payload: { message: next.error } }
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
  return response ?? { type: MessageType.Error, payload: { message: '后台没有处理这条消息。' } }
}

function publish(response: BackgroundResponse, requestId: string | null, sendResponse: (value: BackgroundResponse) => void): void {
  try { sendResponse(response) } catch { /* 原来的消息口已经关掉 */ }
  if (!requestId) return
  try {
    chrome.runtime.sendMessage({ channel: RESULT_CHANNEL, id: requestId, body: response }, () => {
      void chrome.runtime.lastError
    })
  } catch { /* 页面已经离开 */ }
}

/** MV3 Service Worker 是租约、任务和证据的唯一写入方。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return
  if (isRecord(message) && message.channel === RESULT_CHANNEL) return
  const requestId = isRecord(message) && message.channel === CALL_CHANNEL && typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 80
    ? message.id : null
  const payload = requestId && isRecord(message) ? message.message : message
  void dispatchExtensionMessage(payload, sender).then(
    response => publish(response, requestId, sendResponse),
    (error: unknown) => publish({
      type: MessageType.Error,
      payload: { message: error instanceof Error ? error.message : '后台没有完成。' }
    }, requestId, sendResponse)
  )
  return true
})
