import { ref } from 'vue'
import { emptyConnection, type EasyConnectionContext, type EasyTabCandidate } from '../../shared/connection'
import { MessageType, type WorkspaceAction, type WorkspaceResultPayload } from '../../shared/message'
import { sendToBackground } from '../../utils/runtime'

const connection = ref<EasyConnectionContext>(emptyConnection())
const tabs = ref<EasyTabCandidate[]>([])
const customers = ref<WorkspaceResultPayload['customers']>([])
const templates = ref<WorkspaceResultPayload['templates']>([])
const rules = ref<WorkspaceResultPayload['rules']>(null)
const tasks = ref<WorkspaceResultPayload['tasks']>([])
const notice = ref('尚未连接 EASY。')
const demo = import.meta.env.DEV && location.protocol !== 'chrome-extension:'

const keepsData = new Set(['load', 'bind', 'refreshSession', 'saveCustomer', 'saveRules'])
let listening = false

function clearAccount(): void {
  customers.value = []
  templates.value = []
  rules.value = null
  tasks.value = []
}

export function useWorkspace() {
  async function call(action: WorkspaceAction): Promise<WorkspaceResultPayload | null> {
    if (demo && (typeof chrome === 'undefined' || !chrome.runtime?.id)) {
      notice.value = 'DEMO：这是开发预览，没有扩展后台，也不会写入真实数据。'
      return null
    }
    const response = await sendToBackground({ type: MessageType.Workspace, payload: action }, 30_000)
    if (!response || response.type !== MessageType.WorkspaceResult) {
      notice.value = '后台没有响应。'
      return null
    }
    const next = response.payload.connection
    connection.value = next
    notice.value = response.payload.message
    if (action.action === 'listTabs' || action.action === 'bind') tabs.value = response.payload.tabs
    if (next.sessionStatus !== 'authenticated') clearAccount()
    else if (keepsData.has(action.action)) {
      customers.value = response.payload.customers
      templates.value = response.payload.templates
      rules.value = response.payload.rules
      tasks.value = response.payload.tasks
    }
    return response.payload
  }

  if (!listening && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    listening = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      const hit = Object.keys(changes).some(key => key.startsWith('patmail.query.') || key.startsWith('patmail.mail.') || key === 'patmail.connection.snapshot.v1')
      if (!hit || connection.value.sessionStatus !== 'authenticated') return
      void call({ action: 'load' })
    })
  }

  return { connection, tabs, customers, templates, rules, tasks, notice, demo, call }
}
