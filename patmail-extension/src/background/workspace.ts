import { LiveEasyAcceptanceRunner } from '../automation/acceptance-runner'
import { isReadonlyProbe } from '../automation/acceptance-trust'
import type { EvidenceRepository } from '../automation/evidence-store'
import type { TaskStore } from '../automation/task-service'
import type { CustomerQueryProfile } from '../customer/types'
import { readMailRules } from '../mail/repository'
import type { MailRuleBundle } from '../mail/types'
import type { QueryTemplate } from '../query/query-types'
import { isMessage, MessageType, type AppMessage, type BackgroundResponse } from '../shared/message'
import { chooseAppTab, EasyConnectionController, emptyConnection, tabOrigin, type BrowserTabRef, type EasyConnectionContext, type EasyTabCandidate } from '../shared/connection'
import { loadAccount, saveCustomerAccount, saveRuleAccount, type LocalArea } from './account-data'

export interface WorkspacePayload {
  ok: boolean
  message: string
  connection: EasyConnectionContext
  tabs: EasyTabCandidate[]
  customers: CustomerQueryProfile[]
  templates: QueryTemplate[]
  rules: MailRuleBundle | null
  tasks: { taskId: string; createdAt: string; customerName: string; fileCount: number; mailCount: number; status: string; verifiedAt: string; updatedAt: string }[]
  forwarded: AppMessage | null
  appTab: { tabId: number; created: boolean } | null
}

export function workspaceResult(partial: Partial<WorkspacePayload> & { connection: EasyConnectionContext }): BackgroundResponse {
  const payload: WorkspacePayload = {
    ok: partial.ok ?? false,
    message: partial.message ?? partial.connection.message,
    connection: partial.connection,
    tabs: partial.tabs ?? [],
    customers: partial.customers ?? [],
    templates: partial.templates ?? [],
    rules: partial.rules ?? null,
    tasks: partial.tasks ?? [],
    forwarded: partial.forwarded ?? null,
    appTab: partial.appTab ?? null
  }
  return { type: MessageType.WorkspaceResult, payload }
}

const FORWARDED = new Set<string>([
  MessageType.CheckSession, MessageType.CancelSessionCheck, MessageType.SearchFiles, MessageType.CancelFileSearch,
  MessageType.ListHistoryQueries, MessageType.GetHistoryQuery, MessageType.LoadDictionary,
  MessageType.FindMailExecution, MessageType.InspectEasyMail, MessageType.ReadWorkflow,
  MessageType.RefreshWorkflow, MessageType.PreviewWorkflow, MessageType.DiagnoseExistingMail,
  MessageType.RunReadonlyAcceptance
])

export interface WorkspaceHost {
  connection: EasyConnectionController
  area: LocalArea
  tasks: TaskStore | null
  evidence: EvidenceRepository
  queryTabs(): Promise<BrowserTabRef[]>
  getTab(tabId: number): Promise<BrowserTabRef>
  createTab(url: string): Promise<void>
  focusTab(tabId: number, windowId?: number): Promise<void>
  openApp(): Promise<{ tabId: number; created: boolean }>
  sendToTab(tabId: number, message: AppMessage): Promise<unknown>
}

async function accountPayload(host: WorkspaceHost): Promise<Pick<WorkspacePayload, 'customers' | 'templates' | 'rules' | 'tasks'>> {
  const connection = host.connection.context
  if (connection.sessionStatus !== 'authenticated') return { customers: [], templates: [], rules: null, tasks: [] }
  const account = await loadAccount(host.area, connection.easyOrigin, connection.operatorId)
  const tasks = host.tasks ? await host.tasks.list(connection.easyOrigin, connection.operatorId) : []
  return {
    customers: account.customers,
    templates: account.templates,
    rules: account.rules,
    tasks: tasks.map(task => ({
      taskId: task.taskId, createdAt: task.createdAt, customerName: task.customerName,
      fileCount: task.selectedFiles.length, mailCount: task.items.length, status: task.status,
      verifiedAt: task.verifiedAt, updatedAt: task.updatedAt
    }))
  }
}

async function boundTab(host: WorkspaceHost): Promise<{ ok: true; tabId: number } | { ok: false; message: string }> {
  const tabId = host.connection.context.easyTabId
  if (tabId == null) return { ok: false, message: '尚未连接 EASY。' }
  try {
    const tab = await host.getTab(tabId)
    if (typeof tab.id !== 'number' || !tabOrigin(tab.url)) {
      host.connection.context = { ...emptyConnection(), sessionStatus: 'error', message: '绑定页面已经离开 EASY 站点。' }
      return { ok: false, message: host.connection.context.message }
    }
    return { ok: true, tabId }
  } catch {
    host.connection.detach(tabId)
    return { ok: false, message: '绑定的 EASY 标签页已关闭。' }
  }
}

export async function handleWorkspaceMessage(message: AppMessage, host: WorkspaceHost): Promise<BackgroundResponse> {
  if (message.type !== MessageType.Workspace) {
    return workspaceResult({ ok: false, message: '后台没有处理这条消息。', connection: host.connection.context })
  }
  const action = message.payload
  if (action.action === 'focus') {
    const appTab = await host.openApp()
    return workspaceResult({ ok: true, message: appTab.created ? '已打开工作台。' : '已回到已打开的工作台。', connection: host.connection.context, appTab })
  }
  if (action.action === 'openLogin') {
    await host.createTab(`${host.connection.context.easyOrigin}/`)
    return workspaceResult({ ok: true, message: '已打开 EASY 登录页面。连接前仍需要选择标签页。', connection: host.connection.context })
  }
  if (action.action === 'listTabs') {
    const tabs = host.connection.list(await host.queryTabs())
    const text = tabs.length === 0 ? '尚未连接 EASY。' : tabs.length === 1 ? '发现一个 EASY 标签页，请确认后连接。' : '发现多个 EASY 标签页，请选择要连接的页面。'
    return workspaceResult({ ok: true, message: text, connection: host.connection.context, tabs })
  }
  if (action.action === 'bind') {
    const tabs = host.connection.list(await host.queryTabs())
    const chosen = tabs.find(tab => tab.id === action.tabId)
    if (!chosen) {
      return workspaceResult({ ok: false, message: '请选择一个 EASY 标签页。', connection: host.connection.context, tabs })
    }
    const begun = host.connection.beginBind(chosen)
    if (!begun.ok) return workspaceResult({ ok: false, message: begun.message, connection: host.connection.context, tabs })
    await readBoundSession(host)
    const account = await accountPayload(host)
    return workspaceResult({ ok: host.connection.context.sessionStatus === 'authenticated', message: host.connection.context.message, connection: host.connection.context, tabs, ...account })
  }
  if (action.action === 'refreshSession') {
    await readBoundSession(host)
    const account = await accountPayload(host)
    return workspaceResult({ ok: host.connection.context.sessionStatus === 'authenticated', message: host.connection.context.message || '已重新检测会话。', connection: host.connection.context, ...account })
  }
  if (action.action === 'load') {
    const account = await accountPayload(host)
    return workspaceResult({ ok: true, message: host.connection.context.message, connection: host.connection.context, ...account })
  }
  if (action.action === 'saveCustomer') {
    if (host.connection.context.sessionStatus !== 'authenticated') {
      return workspaceResult({ ok: false, message: '尚未确认 EASY 用户，不能保存客户。', connection: host.connection.context })
    }
    try {
      await saveCustomerAccount(host.area, host.connection.context.easyOrigin, host.connection.context.operatorId, action.profile)
    } catch (error) {
      return workspaceResult({ ok: false, message: error instanceof Error ? error.message : '客户没有保存。', connection: host.connection.context })
    }
    const account = await accountPayload(host)
    return workspaceResult({ ok: true, message: '客户配置已保存。', connection: host.connection.context, ...account })
  }
  if (action.action === 'saveRules') {
    if (host.connection.context.sessionStatus !== 'authenticated') {
      return workspaceResult({ ok: false, message: '尚未确认 EASY 用户，不能保存规则。', connection: host.connection.context })
    }
    const checked = readMailRules(action.bundle, host.connection.context.operatorId)
    if (!checked.writable) {
      return workspaceResult({ ok: false, message: checked.warning ?? '发文配置未通过校验。', connection: host.connection.context })
    }
    try {
      await saveRuleAccount(host.area, host.connection.context.easyOrigin, host.connection.context.operatorId, checked.bundle, host.tasks)
    } catch (error) {
      return workspaceResult({ ok: false, message: error instanceof Error ? error.message : '规则没有保存。', connection: host.connection.context })
    }
    const account = await accountPayload(host)
    return workspaceResult({ ok: true, message: '发文规则已保存。内容变化的旧任务会标记为过期。', connection: host.connection.context, ...account })
  }
  if (action.action === 'forward') {
    const target = await boundTab(host)
    if (!target.ok) return workspaceResult({ ok: false, message: target.message, connection: host.connection.context })
    if (!FORWARDED.has(action.message.type)) {
      return workspaceResult({ ok: false, message: '完整页面不能转发这个请求。', connection: host.connection.context })
    }
    try {
      const response = await host.sendToTab(target.tabId, action.message)
      if (!isMessage(response) || response.type === MessageType.Workspace || response.type === MessageType.WorkspaceResult) {
        return workspaceResult({ ok: false, message: 'EASY 页面没有返回可识别的结果。', connection: host.connection.context })
      }
      return workspaceResult({ ok: true, message: '', connection: host.connection.context, forwarded: response })
    } catch {
      host.connection.detach(target.tabId)
      return workspaceResult({ ok: false, message: '绑定的 EASY 标签页已失效。', connection: host.connection.context })
    }
  }
  if (action.action === 'runAcceptance') {
    const target = await boundTab(host)
    if (!target.ok) return workspaceResult({ ok: false, message: target.message, connection: host.connection.context })
    if (host.connection.context.sessionStatus !== 'authenticated') {
      await readBoundSession(host)
    }
    if (host.connection.context.sessionStatus !== 'authenticated') {
      return workspaceResult({ ok: false, message: host.connection.context.message || '尚未确认 EASY 用户。', connection: host.connection.context })
    }
    let response: unknown
    try {
      response = await host.sendToTab(target.tabId, { type: MessageType.RunReadonlyAcceptance, payload: { call: action.call, expected: {} } })
    } catch {
      host.connection.detach(target.tabId)
      return workspaceResult({ ok: false, message: '绑定的 EASY 标签页已失效。', connection: host.connection.context })
    }
    const probe = isMessage(response) && response.type === MessageType.AcceptanceResult ? response.payload.probe : undefined
    if (!isReadonlyProbe(probe)) {
      return workspaceResult({ ok: false, message: '只读验收没有带回可复核的响应。', connection: host.connection.context })
    }
    const runner = new LiveEasyAcceptanceRunner({ kind: 'live', call: async () => probe })
    const row = await runner.run({
      origin: host.connection.context.easyOrigin,
      operatorId: host.connection.context.operatorId,
      call: action.call,
      expected: {}
    })
    await host.evidence.saveAcceptance(row)
    return workspaceResult({
      ok: true,
      message: `${row.call} ${row.result}`,
      connection: host.connection.context,
      forwarded: { type: MessageType.AcceptanceResult, payload: { records: [row as unknown as Record<string, unknown>] } }
    })
  }
  return workspaceResult({ ok: false, message: '后台没有处理这条消息。', connection: host.connection.context })
}

async function readBoundSession(host: WorkspaceHost): Promise<void> {
  const target = await boundTab(host)
  if (!target.ok) return
  const previous = host.connection.context.operatorId
  try {
    const response = await host.sendToTab(target.tabId, { type: MessageType.CheckSession })
    if (!isMessage(response) || response.type !== MessageType.SessionResult) {
      host.connection.applySession({ ok: false, message: '无法读取该标签页的登录状态。' })
      return
    }
    if (!response.payload.ok) {
      host.connection.applySession({
        ok: false,
        status: response.payload.error.code === 'SESSION_EXPIRED' ? 'expired' : 'error',
        message: response.payload.error.message
      })
      return
    }
    host.connection.applySession({
      ok: true,
      status: response.payload.data.status,
      userId: response.payload.data.userId,
      displayName: response.payload.data.displayName,
      checkedAt: response.payload.data.checkedAt,
      message: response.payload.data.message
    })
    if (previous && host.connection.context.operatorId && previous !== host.connection.context.operatorId) {
      host.connection.context = { ...host.connection.context, message: '已切换到当前标签页的登录用户。' }
    }
  } catch {
    host.connection.detach(target.tabId)
  }
}

export async function openWorkspaceTab(tabs: BrowserTabRef[], appUrl: string, focus: (id: number, windowId?: number) => Promise<void>, create: () => Promise<number>): Promise<{ tabId: number; created: boolean }> {
  const choice = chooseAppTab(tabs, appUrl)
  if (choice.action === 'focus') {
    const tab = tabs.find(item => item.id === choice.id)
    await focus(choice.id, tab?.windowId)
    return { tabId: choice.id, created: false }
  }
  return { tabId: await create(), created: true }
}
