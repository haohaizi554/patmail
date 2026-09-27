import { LiveEasyAcceptanceRunner } from '../automation/acceptance-runner'
import { acceptanceBlockReason, blockedAcceptance } from '../automation/acceptance-context'
import { isReadonlyProbe } from '../automation/acceptance-trust'
import type { EvidenceRepository } from '../automation/evidence-store'
import type { TaskStore } from '../automation/task-service'
import type { CustomerQueryProfile } from '../customer/types'
import { readMailRules } from '../mail/repository'
import type { MailRuleBundle } from '../mail/types'
import type { QueryTemplate } from '../query/query-types'
import { chooseAppTab, EasyConnectionController, emptyConnection, accountScopeMatches, freezeAccount, sameAccountContext, tabOrigin, type AccountContextSnapshot, type BrowserTabRef, type EasyConnectionContext, type EasyTabCandidate, type ExpectedAccountScope, type SessionObservation } from '../shared/connection'
import { isMessage, MessageType, type AppMessage, type BackgroundResponse, type CreatedTaskResult } from '../shared/message'
import { loadAccount, deleteCustomerAccount, deleteQueryTemplateAccount, refreshStaleTasks, saveCustomerAccount, saveQueryTemplateAccount, saveRuleAccount, type LocalArea } from './account-data'
import { observeSearchPage, resolveSelectedFiles, toQueryObservation, type QueryObservationResult } from '../automation/file-search-snapshot'
import { rememberFileTypeTree } from '../automation/file-description-resolver'
import { isConfirmedOperator } from '../automation/operator'
import { planTrustedTask } from '../automation/task-planner'
import type { AutomationTask } from '../automation/types'

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
  createdTask: CreatedTaskResult | null
  contextError?: 'STALE_CONTEXT'
  rulesSaved?: boolean
  tasksRevalidated?: boolean
  pendingRevalidation?: boolean
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
    appTab: partial.appTab ?? null,
    createdTask: partial.createdTask ?? null,
    ...(partial.contextError ? { contextError: partial.contextError } : {}),
    ...(partial.rulesSaved !== undefined ? { rulesSaved: partial.rulesSaved, tasksRevalidated: partial.tasksRevalidated, pendingRevalidation: partial.pendingRevalidation } : {})
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
  persist?(context: EasyConnectionContext): void
}

class StaleContextError extends Error {
  constructor() { super('STALE_CONTEXT') }
}

async function accountPayload(host: WorkspaceHost, frozen?: AccountContextSnapshot): Promise<Pick<WorkspacePayload, 'customers' | 'templates' | 'rules' | 'tasks'>> {
  const start = frozen ?? freezeAccount(host.connection.context)
  if (!start) return { customers: [], templates: [], rules: null, tasks: [] }
  if (!sameAccountContext(host.connection.context, start)) throw new StaleContextError()
  const account = await loadAccount(host.area, start.easyOrigin, start.operatorId)
  const tasks = host.tasks ? await host.tasks.list(start.easyOrigin, start.operatorId) : []
  if (!sameAccountContext(host.connection.context, start)) throw new StaleContextError()
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

async function readAccount(host: WorkspaceHost, frozen?: AccountContextSnapshot): Promise<Pick<WorkspacePayload, 'customers' | 'templates' | 'rules' | 'tasks'> | null> {
  try {
    return await accountPayload(host, frozen)
  } catch (error) {
    if (error instanceof StaleContextError) return null
    throw error
  }
}

function staleResult(host: WorkspaceHost): BackgroundResponse {
  return workspaceResult({
    ok: false,
    message: 'STALE_CONTEXT',
    contextError: 'STALE_CONTEXT',
    connection: host.connection.context
  })
}

function rememberObservedSearch(frozen: AccountContextSnapshot, request: AppMessage, response: AppMessage): Promise<QueryObservationResult | null> {
  if (request.type !== MessageType.SearchFiles || response.type !== MessageType.SearchFilesResult || !response.payload.ok || !response.payload.data) return Promise.resolve(null)
  const continuation = request.payload.continuation
  return observeSearchPage({
    scope: frozen,
    query: request.payload.query,
    result: response.payload.data,
    ...(continuation ? { run: { mode: 'continue' as const, querySessionId: continuation.querySessionId } } : { run: { mode: 'start' as const } })
  }).then(toQueryObservation)
}

function sourceMessageFor(recorded: QueryObservationResult): string {
  if (!recorded.ok) return recorded.code === 'QUERY_SESSION_INVALID' ? '这次翻页的查询运行已失效，请重新查询。' : recorded.code === 'QUERY_SESSION_REVALIDATION_REQUIRED' ? recorded.message : recorded.message
  if (recorded.revocationDiagnostic) return recorded.revocationDiagnostic
  if (recorded.status === 'CONFLICT') return '查询运行冲突。'
  if (recorded.persistence === 'PERSISTED') return '已保存查询来源。'
  if (recorded.persistence === 'MEMORY_ONLY') return '仅内存保存。'
  return '查询来源保存失败。'
}

function annotateSearch<T extends AppMessage>(response: T, recorded: QueryObservationResult): T {
  if (response.type !== MessageType.SearchFilesResult || !response.payload.ok || !response.payload.data) return response
  const data = { ...response.payload.data }
  delete data.querySessionId
  if (recorded.ok) {
    data.querySessionId = recorded.querySessionId
    data.sourcePersistence = recorded.persistence
    data.sourceCode = recorded.status === 'CONFLICT' ? 'FILE_DATA_CONFLICT' : recorded.persistence
    data.sourceMessage = sourceMessageFor(recorded)
  } else {
    data.sourceCode = recorded.code
    data.sourceMessage = sourceMessageFor(recorded)
  }
  return { ...response, payload: { ...response.payload, data } }
}

function stripSearchContinuation(message: AppMessage): AppMessage {
  if (message.type !== MessageType.SearchFiles) return message
  return { type: MessageType.SearchFiles, payload: { query: message.payload.query } }
}

function createdOf(task: AutomationTask): CreatedTaskResult {
  return {
    taskId: task.taskId,
    taskFingerprint: task.taskFingerprint,
    status: task.status,
    createdAt: task.createdAt,
    itemCount: task.items.length,
    persisted: true,
    fileSource: task.fileSource === 'SEARCH_RESPONSE_OBSERVED' ? 'SEARCH_RESPONSE_OBSERVED' : 'FILE_SOURCE_UNVERIFIED'
  }
}

async function boundTab(host: WorkspaceHost): Promise<{ ok: true; tabId: number } | { ok: false; message: string }> {
  const tabId = host.connection.context.easyTabId
  if (tabId == null) return { ok: false, message: '尚未连接 EASY。' }
  try {
    const tab = await host.getTab(tabId)
    if (typeof tab.id !== 'number' || !tabOrigin(tab.url)) {
      host.connection.context = {
        ...emptyConnection(),
        lastOperatorId: host.connection.context.lastOperatorId,
        connectionVersion: host.connection.context.connectionVersion + 1,
        sessionStatus: 'error',
        message: '绑定页面已经离开 EASY 站点。'
      }
      remember(host)
      return { ok: false, message: host.connection.context.message }
    }
    return { ok: true, tabId }
  } catch {
    host.connection.detach(tabId)
    remember(host)
    return { ok: false, message: '绑定的 EASY 标签页已关闭。' }
  }
}

/** 写操作前重新读取登录身份，并返回冻结后的账号。 */
async function mutationGuard(host: WorkspaceHost, scope: ExpectedAccountScope): Promise<{ ok: true; account: AccountContextSnapshot } | { ok: false; response: BackgroundResponse }> {
  const gate = await recheckBoundSession(host)
  if (gate !== 'same') {
    const account = await readAccount(host)
    return { ok: false, response: workspaceResult({ ok: false, message: gate === 'changed' ? '会话已变化，请重新读取后再保存。' : (host.connection.context.message || '尚未确认 EASY 用户。'), connection: host.connection.context, ...(account ?? {}) }) }
  }
  if (!accountScopeMatches(host.connection.context, scope)) {
    const account = await readAccount(host)
    return { ok: false, response: workspaceResult({ ok: false, message: '保存时的账号与当前会话不一致，已拒绝。', connection: host.connection.context, ...(account ?? {}) }) }
  }
  const frozen = freezeAccount(host.connection.context)
  if (!frozen) {
    return { ok: false, response: workspaceResult({ ok: false, message: host.connection.context.message || '尚未确认 EASY 用户。', connection: host.connection.context }) }
  }
  return { ok: true, account: frozen }
}

async function recheckTasks(host: WorkspaceHost, frozen: AccountContextSnapshot): Promise<void> {
  if (!host.tasks || !sameAccountContext(host.connection.context, frozen)) return
  const account = await loadAccount(host.area, frozen.easyOrigin, frozen.operatorId)
  if (!account.rules || !sameAccountContext(host.connection.context, frozen)) return
  await refreshStaleTasks(host.tasks, frozen.easyOrigin, frozen.operatorId, account.rules, account.customers, account.templates)
}
export async function recheckBoundSession(host: WorkspaceHost): Promise<'same' | 'changed' | 'invalid'> {
  if (host.connection.context.easyTabId == null) return 'invalid'
  const version = host.connection.context.connectionVersion
  const operator = host.connection.context.operatorId
  await readBoundSession(host)
  if (host.connection.context.connectionVersion !== version) return 'changed'
  if (operator && host.connection.context.operatorId !== operator) return 'changed'
  if (host.connection.context.sessionStatus !== 'authenticated') return 'invalid'
  return 'same'
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
    return workspaceResult({ ok: true, message: '已打开 EASY 登录页面。登录后重新打开工作台即可读取该账号。', connection: host.connection.context })
  }
  if (action.action === 'listTabs' || action.action === 'load' || action.action === 'refreshSession') {
    const tabs = await ensureEasySession(host)
    const account = await readAccount(host)
    if (!account) return staleResult(host)
    const connected = host.connection.context.sessionStatus === 'authenticated'
    const name = host.connection.context.displayName
    const idle = tabs.length === 0 ? '尚未连接 EASY。' : '已找到 EASY 页面，但还没有读到登录。请刷新该 EASY 页面。'
    return workspaceResult({
      ok: action.action === 'refreshSession' ? connected : true,
      message: host.connection.context.message || (connected ? (name ? `已连接 ${name}` : '已连接到当前登录账号。') : action.action === 'refreshSession' ? '已重新检测会话。' : idle),
      connection: host.connection.context,
      tabs,
      ...account
    })
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
    const account = await readAccount(host)
    if (!account) return staleResult(host)
    return workspaceResult({ ok: host.connection.context.sessionStatus === 'authenticated', message: host.connection.context.message, connection: host.connection.context, tabs, ...account })
  }
  let frozenAccount: AccountContextSnapshot | null = null
  if (action.action === 'saveCustomer' || action.action === 'deleteCustomer' || action.action === 'saveQueryTemplate' || action.action === 'deleteQueryTemplate' || action.action === 'saveRules' || action.action === 'createTaskPlan') {
    const gate = await mutationGuard(host, action.expectedScope)
    if (!gate.ok) return gate.response
    frozenAccount = gate.account
  }
  const frozenNow = (): AccountContextSnapshot => {
    if (!frozenAccount || !sameAccountContext(host.connection.context, frozenAccount)) throw new StaleContextError()
    return frozenAccount
  }
  const failWrite = async (message: string): Promise<BackgroundResponse> => {
    if (!frozenAccount || !sameAccountContext(host.connection.context, frozenAccount)) return staleResult(host)
    const account = await readAccount(host, frozenAccount)
    if (!account) return staleResult(host)
    return workspaceResult({ ok: false, message, connection: host.connection.context, ...account })
  }
  const finishWrite = async (message: string, createdTask: CreatedTaskResult | null = null): Promise<BackgroundResponse> => {
    if (!frozenAccount || !sameAccountContext(host.connection.context, frozenAccount)) return staleResult(host)
    const account = await readAccount(host, frozenAccount)
    if (!account) return staleResult(host)
    return workspaceResult({ ok: true, message, connection: host.connection.context, createdTask, ...account })
  }
  if (action.action === 'saveCustomer') {
    try {
      const frozen = frozenNow()
      await saveCustomerAccount(host.area, frozen.easyOrigin, frozen.operatorId, action.profile, action.expectedRevision)
      await recheckTasks(host, frozen)
      return await finishWrite('客户配置已保存。名称或 EASY GUID 变化的任务会重新核验。')
    } catch (error) {
      if (error instanceof StaleContextError) return staleResult(host)
      return failWrite(error instanceof Error ? error.message : '客户没有保存。')
    }
  }
  if (action.action === 'deleteCustomer') {
    try {
      const frozen = frozenNow()
      await deleteCustomerAccount(host.area, frozen.easyOrigin, frozen.operatorId, action.id, action.expectedRevision)
      await recheckTasks(host, frozen)
      return await finishWrite('客户配置已删除。相关任务会重新核验。')
    } catch (error) {
      if (error instanceof StaleContextError) return staleResult(host)
      return failWrite(error instanceof Error ? error.message : '客户没有删除。')
    }
  }
  if (action.action === 'saveQueryTemplate') {
    try {
      const frozen = frozenNow()
      await saveQueryTemplateAccount(host.area, frozen.easyOrigin, frozen.operatorId, action.template, action.expectedVersion)
      await recheckTasks(host, frozen)
      return await finishWrite('本地模板已保存。原网站历史模板没有被写入。')
    } catch (error) {
      if (error instanceof StaleContextError) return staleResult(host)
      return failWrite(error instanceof Error ? error.message : '模板没有保存。')
    }
  }
  if (action.action === 'deleteQueryTemplate') {
    try {
      const frozen = frozenNow()
      await deleteQueryTemplateAccount(host.area, frozen.easyOrigin, frozen.operatorId, action.id)
      await recheckTasks(host, frozen)
      return await finishWrite('本地模板已删除。')
    } catch (error) {
      if (error instanceof StaleContextError) return staleResult(host)
      return failWrite(error instanceof Error ? error.message : '模板没有删除。')
    }
  }
  if (action.action === 'saveRules') {
    try {
      const frozen = frozenNow()
      const checked = readMailRules(action.bundle, frozen.operatorId)
      if (!checked.writable) return failWrite(checked.warning ?? '发文配置未通过校验。')
      const outcome = await saveRuleAccount(host.area, frozen.easyOrigin, frozen.operatorId, checked.bundle, host.tasks)
      const message = outcome.pendingRevalidation
        ? '发文规则已保存。旧任务重新核验没有完成，可以单独重试，不必再次保存规则。'
        : '发文规则已保存。内容变化的旧任务会标记为过期。'
      if (!frozenAccount || !sameAccountContext(host.connection.context, frozen)) return staleResult(host)
      const account = await readAccount(host, frozen)
      if (!account) return staleResult(host)
      return workspaceResult({
        ok: true,
        message,
        connection: host.connection.context,
        rulesSaved: true,
        tasksRevalidated: outcome.tasksRevalidated,
        pendingRevalidation: outcome.pendingRevalidation,
        ...account
      })
    } catch (error) {
      if (error instanceof StaleContextError) return staleResult(host)
      return failWrite(error instanceof Error ? error.message : '规则没有保存。')
    }
  }
  if (action.action === 'createTaskPlan') {
    try {
      const frozen = frozenNow()
      const accountNow = await loadAccount(host.area, frozen.easyOrigin, frozen.operatorId)
      if (!sameAccountContext(host.connection.context, frozen)) return staleResult(host)
      if (!accountNow.rules || !host.tasks) {
        return workspaceResult({ ok: false, message: '没有可核验的发文规则，任务未保存。', connection: host.connection.context })
      }
      const resolved = await resolveSelectedFiles(action.files, frozen, { profiles: accountNow.customers })
      const task = planTrustedTask({
        origin: frozen.easyOrigin,
        operatorId: frozen.operatorId,
        files: resolved.files,
        rules: accountNow.rules,
        profiles: accountNow.customers,
        templates: accountNow.templates,
        verifiedSelection: resolved.selections
      })
      if (resolved.issue === 'MIXED_QUERY_SESSION') {
        task.issues.push({ code: 'MIXED_QUERY_SESSION', message: '所选文件不属于同一次查询运行。', itemId: '' })
        if (task.status !== 'UNKNOWN') task.status = 'BLOCKED'
      }
      if (resolved.issue === 'FILE_DATA_CONFLICT') {
        task.issues.push({ code: 'FILE_DATA_CONFLICT', message: '同一文件在查询响应中的业务字段不一致，不能进入可信计划。', itemId: '' })
        if (task.status !== 'UNKNOWN') task.status = 'BLOCKED'
      }
      if (resolved.requiresRevalidation) {
        task.issues.push({ code: 'EVIDENCE_REVALIDATION_REQUIRED', message: '查询证据需要重新核验后才能当作当前来源。', itemId: '' })
        if (task.status !== 'UNKNOWN') task.status = 'BLOCKED'
      }
      if (resolved.mismatches.length > 0) {
        task.issues.push({ code: 'FILE_FIELD_MISMATCH', message: '页面提交的文件字段与查询响应不一致，已按查询快照重建。', itemId: '' })
        if (task.status !== 'UNKNOWN') task.status = 'BLOCKED'
      }
      if (!sameAccountContext(host.connection.context, frozen)) return staleResult(host)
      const persisted = await host.tasks.save(task)
      if (!persisted.ok) {
        return workspaceResult({ ok: false, message: persisted.message, connection: host.connection.context })
      }
      if (!sameAccountContext(host.connection.context, frozen)) return staleResult(host)
      return await finishWrite(`已保存 · 任务 ${persisted.task.taskId}`, createdOf(persisted.task))
    } catch (error) {
      if (error instanceof StaleContextError) return staleResult(host)
      return workspaceResult({ ok: false, message: error instanceof Error ? error.message : '任务没有保存。', connection: host.connection.context })
    }
  }
  if (action.action === 'forward') {
    if (action.message.type !== MessageType.CheckSession && action.message.type !== MessageType.CancelSessionCheck) {
      const gate = await recheckBoundSession(host)
      if (gate !== 'same') {
        return workspaceResult({ ok: false, message: gate === 'changed' ? '会话已变化，请重新检测后再继续。' : (host.connection.context.message || '尚未确认 EASY 用户。'), connection: host.connection.context })
      }
    }
    const target = await boundTab(host)
    if (!target.ok) return workspaceResult({ ok: false, message: target.message, connection: host.connection.context })
    if (!FORWARDED.has(action.message.type)) {
      return workspaceResult({ ok: false, message: '完整页面不能转发这个请求。', connection: host.connection.context })
    }
    const frozen = freezeAccount(host.connection.context)
    const version = host.connection.context.connectionVersion
    try {
      const response = await host.sendToTab(target.tabId, stripSearchContinuation(action.message))
      if (frozen && !sameAccountContext(host.connection.context, frozen)) {
        return workspaceResult({ ok: false, message: '账号已经变化，这次查询结果已丢弃。', connection: host.connection.context })
      }
      if (!frozen && host.connection.context.connectionVersion !== version) {
        return workspaceResult({ ok: false, message: '连接已经变化，这次结果已丢弃。', connection: host.connection.context })
      }
      if (!isMessage(response) || response.type === MessageType.Workspace || response.type === MessageType.WorkspaceResult) {
        return workspaceResult({ ok: false, message: 'EASY 页面没有返回可识别的结果。', connection: host.connection.context })
      }
      let forwarded = response
      if (frozen && action.message.type === MessageType.SearchFiles) {
        const recorded = await rememberObservedSearch(frozen, action.message, response)
        if (!sameAccountContext(host.connection.context, frozen)) {
          return workspaceResult({ ok: false, message: '账号已经变化，这次查询结果已丢弃。', connection: host.connection.context })
        }
        if (recorded) forwarded = annotateSearch(response, recorded)
      }
      if (frozen && action.message.type === MessageType.LoadDictionary && response.type === MessageType.DictionaryResult && response.payload.ok && response.payload.data.kind === 'fileType') {
        rememberFileTypeTree(frozen, response.payload.data.caseTypeId, response.payload.data.nodes)
      }
      return workspaceResult({ ok: true, message: '', connection: host.connection.context, forwarded })
    } catch {
      host.connection.detach(target.tabId)
      remember(host)
      return workspaceResult({ ok: false, message: '绑定的 EASY 标签页已失效。', connection: host.connection.context })
    }
  }
  if (action.action === 'runAcceptance') {
    const gate = await recheckBoundSession(host)
    if (gate !== 'same') {
      return workspaceResult({ ok: false, message: gate === 'changed' ? '会话已变化，请重新检测后再验收。' : (host.connection.context.message || '尚未确认 EASY 用户。'), connection: host.connection.context })
    }
    const target = await boundTab(host)
    if (!target.ok) return workspaceResult({ ok: false, message: target.message, connection: host.connection.context })
    const acceptanceContext = { caseTypeId: action.caseTypeId, mailId: action.mailId, flowType: action.flowType, expectedFields: action.expectedFields }
    const blocked = acceptanceBlockReason(action.call, acceptanceContext)
    if (blocked) {
      const row = blockedAcceptance({ origin: host.connection.context.easyOrigin, operatorId: host.connection.context.operatorId, call: action.call, reason: blocked })
      await host.evidence.saveAcceptance(row)
      return workspaceResult({
        ok: true,
        message: `${row.call} ${row.result}`,
        connection: host.connection.context,
        forwarded: { type: MessageType.AcceptanceResult, payload: { records: [row as unknown as Record<string, unknown>] } }
      })
    }
    const version = host.connection.context.connectionVersion
    let response: unknown
    try {
      response = await host.sendToTab(target.tabId, {
        type: MessageType.RunReadonlyAcceptance,
        payload: { call: action.call, expected: action.expectedFields ?? {}, caseTypeId: action.caseTypeId, mailId: action.mailId, flowType: action.flowType }
      })
      if (host.connection.context.connectionVersion !== version) {
        return workspaceResult({ ok: false, message: '连接已经变化，这次验收结果已丢弃。', connection: host.connection.context })
      }
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
      expected: action.expectedFields ?? {}
    })
    await host.evidence.saveAcceptance(row)
    return workspaceResult({
      ok: true,
      message: `${row.call} ${row.result}`,
      connection: host.connection.context,
      forwarded: { type: MessageType.AcceptanceResult, payload: { records: [row as unknown as Record<string, unknown>], probe } }
    })
  }
  return workspaceResult({ ok: false, message: '后台没有处理这条消息。', connection: host.connection.context })
}

function remember(host: WorkspaceHost): void {
  host.persist?.(host.connection.context)
}

function stillUnbound(host: WorkspaceHost, version: number): boolean {
  return host.connection.context.easyTabId == null && host.connection.context.connectionVersion === version
}

async function observeTab(host: WorkspaceHost, tabId: number): Promise<SessionObservation | null> {
  try {
    const response = await host.sendToTab(tabId, { type: MessageType.CheckSession })
    if (!isMessage(response) || response.type !== MessageType.SessionResult) {
      return { ok: false, message: '无法读取该标签页的登录状态。' }
    }
    if (!response.payload.ok) {
      if (response.payload.error.code === 'REQUEST_ABORTED') return null
      return {
        ok: false,
        status: response.payload.error.code === 'SESSION_EXPIRED' ? 'expired' : 'error',
        message: response.payload.error.message
      }
    }
    return {
      ok: true,
      status: response.payload.data.status,
      userId: response.payload.data.userId,
      displayName: response.payload.data.displayName,
      checkedAt: response.payload.data.checkedAt,
      message: response.payload.data.message
    }
  } catch {
    return null
  }
}

/** 工作台打开时跟随已经登录的 EASY 标签页。多个不同账号时不代为选择。 */
async function ensureEasySession(host: WorkspaceHost): Promise<EasyTabCandidate[]> {
  const tabs = host.connection.list(await host.queryTabs())
  const boundId = host.connection.context.easyTabId
  if (boundId != null) {
    if (tabs.some(tab => tab.id === boundId)) {
      await readBoundSession(host)
      return tabs
    }
    host.connection.detach(boundId)
    remember(host)
  }
  const version = host.connection.context.connectionVersion
  const seen: { tab: EasyTabCandidate; observation: SessionObservation }[] = []
  for (const tab of tabs) {
    if (!stillUnbound(host, version)) return host.connection.list(await host.queryTabs())
    const observation = await observeTab(host, tab.id)
    if (!stillUnbound(host, version)) return host.connection.list(await host.queryTabs())
    if (observation) seen.push({ tab, observation })
  }
  const loggedIn = seen.filter(item => item.observation.ok && item.observation.status === 'authenticated' && item.observation.userId && isConfirmedOperator(item.observation.userId))
  const operators = new Set(loggedIn.map(item => item.observation.userId))
  if (operators.size === 1 && loggedIn[0]) {
    const begun = host.connection.beginBind(loggedIn[0].tab)
    if (begun.ok) {
      host.connection.applySession(loggedIn[0].observation, host.connection.context.connectionVersion)
      if (loggedIn.length > 1) host.connection.context = { ...host.connection.context, message: '已连接到当前登录账号。' }
      remember(host)
    }
    return tabs
  }
  if (operators.size > 1) {
    host.connection.context = { ...host.connection.context, message: '发现多个已登录账号，请选择要连接的标签页。' }
    remember(host)
    return tabs
  }
  if (tabs.length === 1 && seen[0]) {
    const begun = host.connection.beginBind(seen[0].tab)
    if (begun.ok) {
      host.connection.applySession(seen[0].observation, host.connection.context.connectionVersion)
      remember(host)
    }
    return tabs
  }
  if (tabs.length > 0) {
    host.connection.context = {
      ...host.connection.context,
      message: seen.length === 0 ? '找到 EASY 页面，但还读不到登录状态。请刷新该页面后再检测。' : '这些 EASY 页面都没有已登录账号。'
    }
    remember(host)
  }
  return tabs
}

async function readBoundSession(host: WorkspaceHost, attempt = 0): Promise<void> {
  const target = await boundTab(host)
  if (!target.ok) return
  const version = host.connection.context.connectionVersion
  const tabId = target.tabId
  const previous = host.connection.context.operatorId || host.connection.context.lastOperatorId
  const retry = async (): Promise<void> => {
    if (attempt >= 2 || host.connection.context.easyTabId !== tabId) return
    await new Promise(resolve => setTimeout(resolve, 250))
    if (host.connection.context.easyTabId !== tabId) return
    await readBoundSession(host, attempt + 1)
  }
  try {
    const response = await host.sendToTab(tabId, { type: MessageType.CheckSession })
    if (host.connection.context.easyTabId !== tabId) return
    if (host.connection.context.connectionVersion !== version) {
      await retry()
      return
    }
    if (!isMessage(response) || response.type !== MessageType.SessionResult) {
      host.connection.applySession({ ok: false, message: '无法读取该标签页的登录状态。' }, version)
      remember(host)
      return
    }
    if (!response.payload.ok) {
      if (response.payload.error.code === 'REQUEST_ABORTED') return
      host.connection.applySession({
        ok: false,
        status: response.payload.error.code === 'SESSION_EXPIRED' ? 'expired' : 'error',
        message: response.payload.error.message
      }, version)
      remember(host)
      return
    }
    host.connection.applySession({
      ok: true,
      status: response.payload.data.status,
      userId: response.payload.data.userId,
      displayName: response.payload.data.displayName,
      checkedAt: response.payload.data.checkedAt,
      message: response.payload.data.message
    }, version)
    if (previous && host.connection.context.operatorId && previous !== host.connection.context.operatorId) {
      host.connection.context = { ...host.connection.context, message: '已切换到当前标签页的登录用户。' }
    }
    remember(host)
  } catch {
    if (host.connection.context.easyTabId !== tabId) return
    if (attempt < 2) {
      await retry()
      return
    }
    if (host.connection.context.connectionVersion !== version) return
    host.connection.context = {
      ...host.connection.context,
      operatorId: '',
      displayName: '',
      sessionStatus: 'pending',
      message: '已找到 EASY 页面，但还没有读到登录。请刷新该页面。'
    }
    remember(host)
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
