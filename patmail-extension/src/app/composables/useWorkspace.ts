import { ref } from 'vue'
import { emptyConnection, sameConnectionSnapshot, type ConnectionSnapshot, type EasyConnectionContext, type EasyTabCandidate } from '../../shared/connection'
import { MessageType, type WorkspaceAction, type WorkspaceResultPayload } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'

const connection = ref<EasyConnectionContext>(emptyConnection())
const tabs = ref<EasyTabCandidate[]>([])
const customers = ref<WorkspaceResultPayload['customers']>([])
const templates = ref<WorkspaceResultPayload['templates']>([])
const rules = ref<WorkspaceResultPayload['rules']>(null)
const tasks = ref<WorkspaceResultPayload['tasks']>([])
const fileManageRuns = ref<WorkspaceResultPayload['fileManageRuns']>([])
const notice = ref('尚未连接 EASY。')
const accountEpoch = ref(0)
const demo = import.meta.env.DEV && location.protocol !== 'chrome-extension:'

const keepsData = new Set(['load', 'bind', 'refreshSession', 'saveCustomer', 'deleteCustomer', 'saveQueryTemplate', 'deleteQueryTemplate', 'saveRules', 'createTaskPlan', 'recordFileManageRun'])
const mutations = new Set(['saveCustomer', 'deleteCustomer', 'saveQueryTemplate', 'deleteQueryTemplate', 'saveRules', 'createTaskPlan', 'recordFileManageRun'])
let listening = false
let requestSerial = 0
let mutationSerial = 0
let connectionEpoch = 0
let inflight = 0
let accountKey = ''
let storagePending: 'data' | 'session' | null = null

export interface WorkspaceCommitCheck {
  requestId: number
  latestRequestId: number
  expectedOrigin: string
  responseOrigin: string
  responseOperatorId: string
  responseAuthenticated: boolean
  kind?: 'read' | 'mutation' | 'account'
  latestMutationId?: number
  expectedEpoch?: number
  connectionEpoch?: number
}

/** 过期请求不能提交。同账号的保存回执不会被后面的只读刷新丢掉。换账号后旧请求失效。 */
export function canCommitWorkspaceResponse(input: WorkspaceCommitCheck): boolean {
  if (input.expectedEpoch !== undefined && input.connectionEpoch !== undefined && input.expectedEpoch !== input.connectionEpoch) return false
  if (input.kind === 'mutation') {
    if (input.expectedEpoch !== undefined && input.connectionEpoch !== undefined && input.expectedEpoch !== input.connectionEpoch) return false
  } else if (input.requestId !== input.latestRequestId) return false
  if (input.expectedOrigin && input.responseOrigin && input.responseOrigin !== input.expectedOrigin) return false
  if (input.responseAuthenticated && (!input.responseOrigin || !input.responseOperatorId)) return false
  return true
}

/** 有未完成请求时先记住存储变化，请求结束后再读一次。不按固定时间去抖。 */
export function absorbStorageEvent(input: { inflight: number; pending: 'data' | 'session' | null }, change: 'data' | 'session' | null): { pending: 'data' | 'session' | null; refresh: 'data' | 'session' | null } {
  if (!change) return { pending: input.pending, refresh: null }
  if (input.inflight > 0) {
    const pending = input.pending === 'data' || change === 'data' ? 'data' : change
    return { pending, refresh: null }
  }
  return { pending: null, refresh: change }
}

function clearAccount(): void {
  customers.value = []
  templates.value = []
  rules.value = null
  tasks.value = []
  fileManageRuns.value = []
}

function noteAccount(next: EasyConnectionContext): void {
  const key = `${next.easyOrigin}\u0000${next.operatorId}\u0000${next.connectionVersion}`
  if (key === accountKey) return
  const previous = accountKey
  accountKey = key
  accountEpoch.value += 1
  if (previous) connectionEpoch += 1
}

function snapshotOf(current: EasyConnectionContext): ConnectionSnapshot {
  return {
    easyOrigin: current.easyOrigin,
    easyTabId: current.easyTabId,
    lastOperatorId: current.operatorId || current.lastOperatorId,
    connectionVersion: current.connectionVersion
  }
}

export function useWorkspace() {
  function applyPayload(action: WorkspaceAction, payload: WorkspaceResultPayload): void {
    const next = payload.connection
    const operatorChanged = connection.value.operatorId !== next.operatorId || connection.value.connectionVersion !== next.connectionVersion
    connection.value = next
    notice.value = payload.message
    noteAccount(next)
    if (payload.contextError === 'STALE_CONTEXT') {
      clearAccount()
      if (next.sessionStatus === 'authenticated') void call({ action: 'load' })
      return
    }
    if (action.action === 'listTabs' || action.action === 'bind' || action.action === 'load' || action.action === 'refreshSession') tabs.value = payload.tabs
    if (next.sessionStatus !== 'authenticated') clearAccount()
    else if (operatorChanged) {
      clearAccount()
      if (keepsData.has(action.action)) {
        customers.value = payload.customers
        templates.value = payload.templates
        rules.value = payload.rules
        tasks.value = payload.tasks
        fileManageRuns.value = payload.fileManageRuns ?? []
      }
    } else if (keepsData.has(action.action)) {
      customers.value = payload.customers
      templates.value = payload.templates
      rules.value = payload.rules
      tasks.value = payload.tasks
      fileManageRuns.value = payload.fileManageRuns ?? []
    }
  }

  function flushStorage(): void {
    if (inflight > 0 || !storagePending) return
    const pending = storagePending
    storagePending = null
    if (pending === 'data' && connection.value.sessionStatus === 'authenticated') void call({ action: 'load' })
    else if (pending === 'session') void call({ action: 'refreshSession' })
  }

  async function call(action: WorkspaceAction): Promise<WorkspaceResultPayload | null> {
    if (demo && (typeof chrome === 'undefined' || !chrome.runtime?.id)) {
      notice.value = 'DEMO：这是开发预览，没有扩展后台，也不会写入真实数据。'
      return null
    }
    const kind = mutations.has(action.action) ? 'mutation' : action.action === 'bind' || action.action === 'refreshSession' ? 'account' : 'read'
    const epoch = connectionEpoch
    const requestId = kind === 'mutation' ? ++mutationSerial : ++requestSerial
    const expectedOrigin = connection.value.easyOrigin
    inflight += 1
    try {
      const response = await sendToBackground({ type: MessageType.Workspace, payload: action }, 30_000)
      const stillCurrent = kind === 'mutation' ? requestId === mutationSerial : requestId === requestSerial
      if (!response || response.type !== MessageType.WorkspaceResult) {
        if (stillCurrent && epoch === connectionEpoch) {
          notice.value = response?.type === MessageType.Error ? response.payload.message : '后台没有响应。'
        }
        return null
      }
      const next = response.payload.connection
      if (!canCommitWorkspaceResponse({
        requestId,
        latestRequestId: requestSerial,
        latestMutationId: mutationSerial,
        kind,
        expectedEpoch: epoch,
        connectionEpoch,
        expectedOrigin,
        responseOrigin: next.easyOrigin,
        responseOperatorId: next.operatorId,
        responseAuthenticated: next.sessionStatus === 'authenticated'
      })) return null
      if (kind !== 'mutation' || requestId === mutationSerial) applyPayload(action, response.payload)
      return response.payload
    } finally {
      inflight -= 1
      flushStorage()
    }
  }

  if (!listening && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    listening = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      const dataChanged = Object.keys(changes).some(key => key.startsWith('patmail.query.') || key.startsWith('patmail.mail.') || key.startsWith('patmail.fileManageRuns.'))
      const snapshot = changes['patmail.connection.snapshot.v1']?.newValue as ConnectionSnapshot | undefined
      const sessionChanged = Boolean(snapshot && !sameConnectionSnapshot(snapshotOf(connection.value), snapshot))
      const change = dataChanged ? 'data' : sessionChanged ? 'session' : null
      const planned = absorbStorageEvent({ inflight, pending: storagePending }, change)
      storagePending = planned.pending
      if (planned.refresh === 'data' && connection.value.sessionStatus === 'authenticated') void call({ action: 'load' })
      else if (planned.refresh === 'session') void call({ action: 'refreshSession' })
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      if (connection.value.sessionStatus !== 'authenticated') {
        void call({ action: 'refreshSession' })
        return
      }
      const planned = absorbStorageEvent({ inflight, pending: storagePending }, storagePending ?? 'data')
      storagePending = planned.pending
      if (planned.refresh === 'data') void call({ action: 'load' })
      else if (planned.refresh === 'session') void call({ action: 'refreshSession' })
    })
  }

  return { connection, tabs, customers, templates, rules, tasks, fileManageRuns, notice, accountEpoch, demo, call }
}
