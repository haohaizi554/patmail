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
const notice = ref('尚未连接 EASY。')
const accountEpoch = ref(0)
const demo = import.meta.env.DEV && location.protocol !== 'chrome-extension:'

const keepsData = new Set(['load', 'bind', 'refreshSession', 'saveCustomer', 'deleteCustomer', 'saveQueryTemplate', 'deleteQueryTemplate', 'saveRules', 'createTaskPlan'])
let listening = false
let requestSerial = 0
let inflight = 0
let accountKey = ''

export interface WorkspaceCommitCheck {
  requestId: number
  latestRequestId: number
  expectedOrigin: string
  responseOrigin: string
  responseOperatorId: string
  responseAuthenticated: boolean
}

/** 过期请求不能提交。已登录响应还必须带上来源和操作员，不能只看 authenticated。 */
export function canCommitWorkspaceResponse(input: WorkspaceCommitCheck): boolean {
  if (input.requestId !== input.latestRequestId) return false
  if (input.expectedOrigin && input.responseOrigin && input.responseOrigin !== input.expectedOrigin) return false
  if (input.responseAuthenticated && (!input.responseOrigin || !input.responseOperatorId)) return false
  return true
}

function clearAccount(): void {
  customers.value = []
  templates.value = []
  rules.value = null
  tasks.value = []
}

function noteAccount(next: EasyConnectionContext): void {
  const key = `${next.easyOrigin}\u0000${next.operatorId}\u0000${next.connectionVersion}`
  if (key === accountKey) return
  accountKey = key
  accountEpoch.value += 1
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
  async function call(action: WorkspaceAction): Promise<WorkspaceResultPayload | null> {
    if (demo && (typeof chrome === 'undefined' || !chrome.runtime?.id)) {
      notice.value = 'DEMO：这是开发预览，没有扩展后台，也不会写入真实数据。'
      return null
    }
    const requestId = ++requestSerial
    const expectedOrigin = connection.value.easyOrigin
    inflight += 1
    try {
      const response = await sendToBackground({ type: MessageType.Workspace, payload: action }, 30_000)
      if (!response || response.type !== MessageType.WorkspaceResult) {
        if (requestId === requestSerial) notice.value = '后台没有响应。'
        return null
      }
      const next = response.payload.connection
      if (!canCommitWorkspaceResponse({
        requestId,
        latestRequestId: requestSerial,
        expectedOrigin,
        responseOrigin: next.easyOrigin,
        responseOperatorId: next.operatorId,
        responseAuthenticated: next.sessionStatus === 'authenticated'
      })) return null
      const operatorChanged = connection.value.operatorId !== next.operatorId || connection.value.connectionVersion !== next.connectionVersion
      connection.value = next
      notice.value = response.payload.message
      noteAccount(next)
      if (action.action === 'listTabs' || action.action === 'bind') tabs.value = response.payload.tabs
      if (next.sessionStatus !== 'authenticated') clearAccount()
      else if (operatorChanged) {
        clearAccount()
        if (keepsData.has(action.action)) {
          customers.value = response.payload.customers
          templates.value = response.payload.templates
          rules.value = response.payload.rules
          tasks.value = response.payload.tasks
        }
      } else if (keepsData.has(action.action)) {
        customers.value = response.payload.customers
        templates.value = response.payload.templates
        rules.value = response.payload.rules
        tasks.value = response.payload.tasks
      }
      return response.payload
    } finally {
      inflight -= 1
    }
  }

  if (!listening && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    listening = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || inflight > 0) return
      const dataChanged = Object.keys(changes).some(key => key.startsWith('patmail.query.') || key.startsWith('patmail.mail.'))
      const snapshot = changes['patmail.connection.snapshot.v1']?.newValue as ConnectionSnapshot | undefined
      if (dataChanged && connection.value.sessionStatus === 'authenticated') {
        void call({ action: 'load' })
        return
      }
      if (!snapshot || sameConnectionSnapshot(snapshotOf(connection.value), snapshot)) return
      void call({ action: 'refreshSession' })
    })
  }

  return { connection, tabs, customers, templates, rules, tasks, notice, accountEpoch, demo, call }
}
