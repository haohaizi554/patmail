import { indexedTransactionStore, ExecutionLedger } from '../automation/ledger'
import { IndexedTaskStore } from '../automation/indexed-store'
import { IndexedEvidenceStore, MemoryEvidenceStore } from '../automation/evidence-store'
import { handleAuthorityMessage } from './authority'
import { deliverAgentAnswer, handleAgentChat } from './agent'
import { scopeExtensionPageMessage } from './scope'
import { EasyConnectionController, sameConnectionSnapshot, type ConnectionSnapshot } from '../shared/connection'
import { handleWorkspaceMessage, openWorkspaceTab, recheckBoundSession, resumeEasySession, type WorkspaceHost } from './workspace'
import { isRecord } from '../shared/guards'
import { prepareForwardedSearch } from '../api/message-guards'
import { isMessage, MessageType, type AppMessage, type BackgroundResponse } from '../shared/message'
import { prepareApiDocs } from '../agent/rag-store'
import { hydrateWriteSwitch, watchWriteSwitch } from '../settings/write-switch'

watchWriteSwitch()
// 扩展 Service Worker 不能用顶层 await，否则 Chrome 直接拒绝启动，工具栏点击没有监听。
void hydrateWriteSwitch()
void prepareApiDocs()

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

let warming: Promise<void> | null = null
let warmedAt = 0

const reinjected = new Set<number>()

async function sendToTab(tabId: number, message: AppMessage): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (reinjected.has(tabId) || !/Receiving end does not exist|Could not establish connection/i.test(text) || !chrome.scripting?.executeScript) throw error
    reinjected.add(tabId)
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return chrome.tabs.sendMessage(tabId, message)
  }
}

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
  sendToTab,
  persist: persistConnection
}

function warmEasySession(): Promise<void> {
  if (warming) return warming
  if (connection.context.sessionStatus === 'authenticated' && Date.now() - warmedAt < 1500) return Promise.resolve()
  warming = resumeEasySession(host).finally(() => {
    warming = null
    warmedAt = Date.now()
  })
  return warming
}

/** 先把上次的标签页捡回来，再向页面重读登录。这条完成前不回答工作台，避免把空连接当成没登录。 */
const connectionReady = (async () => {
  try {
    const stored = await chrome.storage.local.get(CONNECTION_SNAPSHOT)
    connection.restoreCandidate(stored[CONNECTION_SNAPSHOT])
    persistedSnapshot = connection.snapshot()
  } catch { /* 没有存过连接 */ }
  await warmEasySession()
})()

chrome.tabs.onRemoved.addListener((tabId) => {
  reinjected.delete(tabId)
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
  MessageType.CompleteExecution, MessageType.ReleaseExecution, MessageType.MarkExecutionUnknown,
  MessageType.ArchiveTask
])
const READS = new Set<string>([
  MessageType.ListTasks, MessageType.GetTask, MessageType.ListAcceptance,
  MessageType.ValidateTaskMetadata, MessageType.RecoverExecution
])

/** 页面和后台用长连接。查询过程中还会调用 EASY 页面，不能占用一次性消息口。 */
async function dispatchExtensionMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  await connectionReady
  prepareForwardedSearch(message)
  if (!isMessage(message)) {
    const type = message && typeof message === 'object' && 'type' in message ? String((message as { type?: unknown }).type) : '未知'
    const inner = message && typeof message === 'object' && 'payload' in message
      && (message as { payload?: { action?: unknown; message?: { type?: unknown } } }).payload?.action === 'forward'
      ? String((message as { payload?: { message?: { type?: unknown } } }).payload?.message?.type ?? '')
      : ''
    return { type: MessageType.Error, payload: { message: `后台没有接住${inner ? `转发 ${inner}` : type}。请在扩展管理页重新加载后再试。` } }
  }
  if (message.type === MessageType.Ping) {
    if (connection.context.sessionStatus !== 'authenticated') void warmEasySession()
    return { type: MessageType.Pong, payload: { ok: true } }
  }
  if (message.type === MessageType.AgentChat) {
    const pageUrl = sender.url ?? sender.tab?.url ?? ''
    if (!pageUrl.startsWith(chrome.runtime.getURL(''))) {
      return { type: MessageType.Error, payload: { message: '只有工作台页面可以调用 AI 助手。' } }
    }
    return { type: MessageType.AgentChatResult, payload: await handleAgentChat(message.payload, host) }
  }
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
  const accountScoped = WRITES.has(message.type) || READS.has(message.type)
  if (accountScoped || fromExtensionPage(sender)) {
    if (accountScoped) {
      const gate = await recheckBoundSession(host)
      if (WRITES.has(message.type) && gate !== 'same') {
        return { type: MessageType.Error, payload: { message: '会话已变化，请重新读取后再保存。' } }
      }
    }
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

/** 每 20 秒碰一次扩展接口，空闲计时就不会到 30 秒。知易通或工作台还开着时，后台不会被睡过去。 */
const HEARTBEAT_MS = 20_000
function beat(): void {
  void chrome.runtime.getPlatformInfo()
}
beat()
setInterval(beat, HEARTBEAT_MS)
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== 'patmail-keepalive') return
    beat()
    if (connection.context.sessionStatus !== 'authenticated') void warmEasySession()
  })
  const created = chrome.alarms.create('patmail-keepalive', { periodInMinutes: 0.5 })
  void Promise.resolve(created).catch(() => {
    void chrome.alarms.create('patmail-keepalive', { periodInMinutes: 1 })
  })
}

/** 工作台停靠栏连着这条端口时，服务工作线程不会在等模型的空档里被回收。 */
let agentPorts = 0
chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.id !== chrome.runtime.id) {
    port.disconnect()
    return
  }
  if (port.name === 'patmail-page') {
    port.onMessage.addListener(() => { /* 页面心跳，重置空闲计时 */ })
    void connectionReady.then(() => warmEasySession())
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError })
    return
  }
  if (port.name !== 'patmail-agent') {
    port.disconnect()
    return
  }
  agentPorts += 1
  port.onMessage.addListener(() => { /* 停靠栏心跳 */ })
  port.onDisconnect.addListener(() => {
    agentPorts = Math.max(0, agentPorts - 1)
    if (agentPorts === 0) deliverAgentAnswer('跳过')
    void chrome.runtime.lastError
  })
})

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
