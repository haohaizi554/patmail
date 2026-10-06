import { apiError, type ApiResult } from '../api/types'
import { loadAgentConfig, type AgentConfig } from '../agent/config'
import { LlmError, chatCompletion } from '../agent/llm'
import { compactAgentMemory, runAgentTurn } from '../agent/loop'
import { loadMemory, saveMemory, visibleHistory, type AgentMemoryState } from '../agent/memory'
import { helpText, resolveSlash } from '../agent/slash'
import { formatDraft, type DeadlineRow, type ToolContext } from '../agent/tools'
import { limitMailItems, summarizeLimitMailSubmit } from '../customer/limit-mail-submit'
import { isWriteSwitchOpen } from '../settings/write-switch'
import { fillFromRules } from '../mail/assemble'
import { groupWorkflowRows } from '../customer/workflow-mail'
import { sheetRecipientNames } from '../customer/pct-recipients'
import type { PctTaskRow } from '../customer/types'
import { workflowPreview } from '../workflow/preview-chart'
import { resolveReviewer } from '../workflow/reviewer-resolver'
import type { WorkflowNode } from '../workflow/types'
import { MAIL_FLOW_TYPE } from '../workflow/contracts'
import { isQueryGuid } from '../query/query-validator'
import { isConfirmedOperator } from '../automation/operator'
import { isRecord } from '../shared/guards'
import type { ProcessKind } from '../api/mail-process'
import { loadAccount, type LocalArea } from './account-data'
import { handleWorkspaceMessage, type WorkspaceHost } from './workspace'
import { isMessage, MessageType, type ContentRequest } from '../shared/message'
import type { PatentFile } from '../api/file-search-types'
import type { SelectedPatentFile } from '../mail/types'
import { createWorkflowInCatalog, setWorkflowFieldInCatalog } from '../agent/actions'
import { searchApiDocs } from '../agent/api-docs'
import { loadWorkflowCatalog, saveWorkflowCatalog } from '../workflow/catalog-store'
import { SKILLS, skillById } from '../workflow/skills'

export interface AgentTurnView {
  reply: string
  model: string
  steps: number
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

const ACTIVITY_CHANNEL = 'patmail-agent-activity'
let turnAbort: AbortController | null = null

export function stopAgentTurn(): void {
  turnAbort?.abort()
}

function sendActivity(label: string, thought?: string): void {
  try {
    chrome.runtime.sendMessage({ channel: ACTIVITY_CHANNEL, label, ...(thought ? { thought } : {}) }, () => {
      void chrome.runtime.lastError
    })
  } catch { /* 页面已经离开 */ }
}

/** 思考增量马上送出，不再攒一批。界面自己按字符往外长。 */
function publishActivity(label: string, thought?: string): void {
  sendActivity(thought ? '正在思考' : label, thought)
}

function viewOf(reply: string, model: string, steps: number, memory: AgentMemoryState): AgentTurnView {
  return { reply, model, steps, history: visibleHistory(memory) }
}

function factsReply(memory: AgentMemoryState): string {
  if (memory.facts.length === 0) return '还没有长期记忆。可以说「记住……」，或用 /记住。'
  return `长期记忆：\n${memory.facts.slice(-12).map(fact => `· ${fact.text}`).join('\n')}`
}

async function clearConversation(area: LocalArea, model: string): Promise<ApiResult<AgentTurnView>> {
  const memory = await loadMemory(area)
  const cleared: AgentMemoryState = { ...memory, summary: '', turns: [] }
  await saveMemory(area, cleared)
  return { ok: true, data: viewOf('这段对话已清空，长期记忆还在。', model, 0, cleared) }
}

async function compactConversation(area: LocalArea, config: AgentConfig): Promise<ApiResult<AgentTurnView>> {
  try {
    const current = await loadMemory(area)
    const compacted = await compactAgentMemory(config, current)
    await saveMemory(area, compacted.memory)
    return { ok: true, data: viewOf(compacted.reply, config.model, 0, compacted.memory) }
  } catch (error) {
    if (error instanceof LlmError) return apiError(error.code, error.message, error.status)
    return apiError('NETWORK_ERROR', 'AI 助手调用没有完成。')
  }
}

function toolContext(host: WorkspaceHost): ToolContext {
  const bucket: SelectedPatentFile[] = []
  const deadlines: DeadlineRow[] = []
  const forward = async (message: ContentRequest): Promise<unknown> => {
      const response = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'forward', message } }, host)
      if (response.type !== MessageType.WorkspaceResult) return { error: '后台没有转发。' }
      if (!response.payload.ok || !response.payload.forwarded) return { error: response.payload.message || '没有结果。' }
      if (!isMessage(response.payload.forwarded)) return { error: 'EASY 页面没有返回可识别的结果。' }
      return response.payload.forwarded
    }
  return {
    snapshot: () => ({
      connected: host.connection.context.sessionStatus === 'authenticated',
      displayName: host.connection.context.displayName,
      origin: host.connection.context.easyOrigin,
      message: host.connection.context.message
    }),
    forward,
    rememberFiles(files) {
      bucket.splice(0, bucket.length, ...files.slice(0, 40))
    },
    recentFiles: () => bucket.slice(),
    rememberDeadlines(rows) {
      deadlines.splice(0, deadlines.length, ...rows.slice(0, 40))
    },
    recentDeadlines: () => deadlines.slice(),
    async customers() {
      const current = host.connection.context
      if (current.sessionStatus !== 'authenticated') return []
      const account = await loadAccount(host.area, current.easyOrigin, current.operatorId)
      return account.customers.map(profile => ({
        name: profile.name,
        workflowId: profile.workflowId ?? '',
        surface: profile.querySurface ?? ''
      }))
    },
    async workflows() {
      const catalog = await loadWorkflowCatalog()
      return catalog.workflows.map(flow => ({
        label: flow.label,
        summary: flow.summary,
        steps: flow.steps.map(step => {
          const skill = skillById(step.skillId)
          return { title: skill?.title ?? step.title, detail: skill?.detail ?? step.detail }
        })
      }))
    },
    skills: () => SKILLS.map(skill => ({ title: skill.title, blurb: skill.blurb, detail: skill.detail })),
    lookupApi: query => searchApiDocs(query),
    async createWorkflow(input) {
      const catalog = await loadWorkflowCatalog()
      const made = createWorkflowInCatalog(catalog, input.name, input.summary, input.skills)
      if (made.catalog !== catalog) await saveWorkflowCatalog(made.catalog)
      return made.text
    },
    async setWorkflowField(input) {
      const catalog = await loadWorkflowCatalog()
      const made = setWorkflowFieldInCatalog(catalog, input.name, input.skill, input.field, input.value)
      if (made.catalog !== catalog) await saveWorkflowCatalog(made.catalog)
      return made.text
    },
    createTask: input => createTaskFromSearch(host, input, forward, bucket),
    readCustomer: name => readCustomer(host, forward, name),
    previewWorkflow: name => previewWorkflow(name),
    draftMail: name => draftMail(host, bucket, name),
    listTasks: () => listTasks(host),
    listHistory: surface => listHistory(forward, surface),
    listReviewers: () => listReviewers(host, forward),
    listProcesses: (kind, searchKey) => listProcesses(forward, kind, searchKey),
    listAcceptance: () => listAcceptance(host),
    readonlyAcceptance: (call, caseTypeId, mailId) => readonlyAcceptance(forward, call, caseTypeId, mailId),
    diagnoseMail: mailId => diagnoseMail(forward, mailId),
    exportContacts: volumes => exportContacts(forward, bucket, volumes),
    submitEasy: caseVolume => submitEasy(host, forward, bucket, deadlines, caseVolume)
  }
}

function selectedFile(item: PatentFile): SelectedPatentFile {
  return {
    fileId: item.fileId,
    fileName: item.fileName,
    fileDescription: item.fileDescription ?? '',
    customerName: item.customerName ?? '',
    ...(item.caseId ? { caseId: item.caseId } : {}),
    ...(item.caseName ? { caseName: item.caseName } : {}),
    ...(item.caseVolume ? { caseVolume: item.caseVolume } : {}),
    ...(item.customerVolume ? { customerVolume: item.customerVolume } : {}),
    ...(item.applicationNo ? { applicationNo: item.applicationNo } : {}),
    ...(item.officialPostDate ? { officialPostDate: item.officialPostDate } : {})
  }
}

type PageForward = (message: ContentRequest) => Promise<unknown>

function forwardError(value: unknown): string | null {
  if (isRecord(value) && typeof value.error === 'string') return value.error
  if (!isMessage(value)) return 'EASY 没有返回可识别的结果。'
  return null
}

function signedIn(host: WorkspaceHost): { origin: string; operatorId: string } | { error: string } {
  const current = host.connection.context
  if (current.sessionStatus !== 'authenticated' || !isConfirmedOperator(current.operatorId)) {
    return { error: current.message || '还没连上 EASY。先打开已经登录的页面，再重新打开工作台。' }
  }
  return { origin: current.easyOrigin, operatorId: current.operatorId }
}

async function readCustomer(host: WorkspaceHost, forward: PageForward, name: string): Promise<string> {
  const session = signedIn(host)
  if ('error' in session) return session.error
  const account = await loadAccount(host.area, session.origin, session.operatorId)
  const profile = account.customers.find(item => item.name === name || item.name.includes(name))
  if (!profile) return `没有对上的客户「${name}」。`
  const lines = [
    `客户 ${profile.name}`,
    `工作流：${profile.workflowId || '未绑定'}`,
    `入口：${profile.querySurface || '未指定'}`
  ]
  if (!profile.easyCustomerId) return `${lines.join('\n')}\n还没有绑定 EASY 客户，名录先不读。`
  const found = await forward({ type: MessageType.ReadCustomerDirectory, payload: { customerId: profile.easyCustomerId } })
  const error = forwardError(found)
  if (error) return `${lines.join('\n')}\n名录没有读到：${error}`
  if (!isMessage(found) || found.type !== MessageType.CustomerDirectoryResult || !found.payload.ok) {
    const message = isMessage(found) && found.type === MessageType.CustomerDirectoryResult && !found.payload.ok ? found.payload.error.message : '名录没有返回。'
    return `${lines.join('\n')}\n${message}`
  }
  const contacts = found.payload.data.rows.slice(0, 8).map(row => [row.name, row.email, row.contactType].filter(Boolean).join('｜'))
  return `${lines.join('\n')}\n名录 ${found.payload.data.rows.length} 人。\n${contacts.join('\n') || '名录是空的。'}`
}

async function previewWorkflow(name: string): Promise<string> {
  const catalog = await loadWorkflowCatalog()
  const flow = catalog.workflows.find(item => item.label === name || item.label.includes(name))
  if (!flow) return '没有对上的工作流。'
  const pieces = workflowPreview(flow)
  const body = pieces.map((piece, index) => {
    const arms = piece.arms?.map(arm => `  ${arm.join(' → ')}`).join('\n') ?? ''
    return `${index + 1}. ${piece.lines.join(' ')}${arms ? `\n${arms}` : ''}`
  }).join('\n')
  return `工作流预览「${flow.label}」\n${body || flow.summary}`
}

async function draftMail(host: WorkspaceHost, bucket: SelectedPatentFile[], customerName: string): Promise<string> {
  if (bucket.length === 0) return '先查案件，这一轮还没有文件可以起草。'
  const session = signedIn(host)
  if ('error' in session) return session.error
  const account = await loadAccount(host.area, session.origin, session.operatorId)
  const named = customerName.trim()
  const usable = named ? bucket.filter(file => file.customerName.includes(named)) : bucket
  const files = usable.length > 0 ? usable : bucket
  const label = named || files[0]?.customerName || ''
  const customer = account.customers.find(item => item.name === label || (label && item.name.includes(label)))
  if (!customer) return `插件里没有对上客户「${label || '未命名'}」。`
  const filled = fillFromRules(customer, files, account.rules, session.operatorId)
  const rows: PctTaskRow[] = files.map(file => ({
    ourVolume: file.caseVolume ?? '',
    customerVolume: file.customerVolume ?? '',
    customerName: file.customerName || customer.name,
    contactName: '',
    iprName: '',
    procLabel: '',
    mailTypeLabel: filled.mailTypeName
  }))
  const groups = groupWorkflowRows(customer.limitMailStyle ?? '1', rows)
  const who = groups.flatMap((group, index) => {
    const row = group[0]
    if (!row) return []
    const names = sheetRecipientNames(row)
    return [`第 ${index + 1} 封：收件 ${names.to || '未定'}，抄送 ${names.cc || '商务'}`]
  }).join('\n')
  return formatDraft({
    letters: groups.length,
    subject: filled.subject,
    body: filled.body,
    notes: filled.notes,
    who: [`收件：${filled.to || '还没有收件人规则'}`, who].filter(Boolean).join('\n')
  })
}

async function listTasks(host: WorkspaceHost): Promise<string> {
  const session = signedIn(host)
  if ('error' in session) return session.error
  if (!host.tasks) return '发文任务还读不到。'
  const tasks = await host.tasks.list(session.origin, session.operatorId, false)
  const lines = tasks.slice(0, 20).map(task => `${task.customerName}｜${task.status}｜${task.selectedFiles.length} 个文件`)
  return `发文任务共 ${tasks.length} 条。\n${lines.join('\n')}`.trim()
}

async function listHistory(forward: PageForward, surface: string): Promise<string> {
  const page = surface === 'limit' ? 'limit' : 'file'
  const found = await forward({ type: MessageType.ListHistoryQueries, payload: { force: false, surface: page } })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.HistoryQueriesResult) return '查询记录没有返回。'
  if (!found.payload.ok) return found.payload.error.message
  const lines = found.payload.data.slice(0, 20).map(item => item.name)
  return `查询记录共 ${found.payload.data.length} 条。\n${lines.join('\n')}`.trim()
}

async function listReviewers(host: WorkspaceHost, forward: PageForward): Promise<string> {
  const session = signedIn(host)
  if ('error' in session) return session.error
  const found = await forward({ type: MessageType.ListFlowReviewers })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.ListFlowReviewersResult) return '审核人没有返回。'
  if (!found.payload.ok) return found.payload.error.message
  const reviewers = found.payload.data.reviewers
  const node: WorkflowNode = {
    listId: 'account',
    seq: 1,
    next: '',
    nodeId: 'account',
    nodeCode: '',
    nodeName: '审核',
    allowSkip: false,
    userType: '',
    parallel: false,
    needAllAudit: false,
    reviewers,
    reviewerFormat: reviewers.length > 0 && reviewers.every(item => isQueryGuid(item.id)) ? 'structured' : 'unknown'
  }
  const decided = resolveReviewer(session.operatorId, node)
  const verdict = decided.status === 'matched' ? '当前登录人在名单里。' : decided.reason
  const names = reviewers.slice(0, 20).map(item => item.name).join('、')
  return `审核人共 ${reviewers.length} 人。${verdict}这一步没有提交审核。\n${names}`.trim()
}

async function listProcesses(forward: PageForward, kind: string, searchKey: string): Promise<string> {
  const found = await forward({
    type: MessageType.ListMailProcesses,
    payload: { query: { kind: kind as ProcessKind, searchKey, pageIndex: 1, pageSize: 10 } }
  })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.ListMailProcessesResult) return '流程名单没有返回。'
  if (!found.payload.ok) return found.payload.error.message
  const data = found.payload.data
  const lines = data.items.slice(0, 10).map(item => Object.values(item.cells).filter(Boolean).slice(0, 4).join('｜'))
  return `流程共 ${data.total} 条。没有打开页面。\n${lines.join('\n')}`.trim()
}

async function listAcceptance(host: WorkspaceHost): Promise<string> {
  const session = signedIn(host)
  if ('error' in session) return session.error
  const records = await host.evidence.listAcceptance(session.origin, session.operatorId)
  const lines = records.slice(0, 20).map(row => `${row.call}｜${row.result}`)
  return `验收共 ${records.length} 条。\n${lines.join('\n')}`.trim()
}

async function readonlyAcceptance(forward: PageForward, call: string, caseTypeId: string, mailId: string): Promise<string> {
  const found = await forward({
    type: MessageType.RunReadonlyAcceptance,
    payload: {
      call,
      expected: {},
      ...(caseTypeId ? { caseTypeId } : {}),
      ...(mailId ? { mailId, flowType: MAIL_FLOW_TYPE } : {})
    }
  })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.AcceptanceResult) return '只读验收没有返回。'
  const row = found.payload.records[0]
  const result = isRecord(row) && typeof row.result === 'string' ? row.result : '已核对'
  return `只读验收 ${call}：${result}。没有发送写请求。`
}

async function diagnoseMail(forward: PageForward, mailId: string): Promise<string> {
  if (!isQueryGuid(mailId)) return '邮件编号格式不对。'
  const found = await forward({ type: MessageType.DiagnoseExistingMail, payload: { mailId, flowType: MAIL_FLOW_TYPE } })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.ExistingMailDiagnostic) return '邮件核对没有返回。'
  const view = found.payload
  const files = view.fileNames.slice(0, 8).join('、')
  const blockers = view.blockers.length ? view.blockers.join('\n') : '没有拦下的项。'
  return `邮件核对 ${view.mailId}\n文件：${files || '没有文件'}\n${blockers}\n没有写入。`
}

function volumeList(raw: string, bucket: SelectedPatentFile[]): string[] {
  const typed = raw.split(/[\s,，;；]+/).map(item => item.trim()).filter(Boolean)
  const fromFiles = bucket.map(file => file.customerVolume || file.caseVolume || '').filter(Boolean)
  return [...new Set(typed.length > 0 ? typed : fromFiles)].slice(0, 20)
}

async function exportContacts(forward: PageForward, bucket: SelectedPatentFile[], volumes: string): Promise<string> {
  const list = volumeList(volumes, bucket)
  if (list.length === 0) return '还没有文号可以导出联系人。先查案件，或在原话里给出文号。'
  const found = await forward({ type: MessageType.ExportCaseContacts, payload: { volumes: list } })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.ExportCaseContactsResult) return '联系人没有返回。'
  if (!found.payload.ok) return found.payload.error.message
  const data = found.payload.data
  const lines = data.rows.slice(0, 20).map(row => [row.volume, row.tech, row.email].filter(Boolean).join('｜'))
  const missed = data.unmatched.length ? `未对上：${data.unmatched.join('、')}` : ''
  return `联系人共 ${data.rows.length} 行。\n${lines.join('\n')}\n${missed}`.trim()
}

async function submitEasy(
  host: WorkspaceHost,
  forward: PageForward,
  bucket: SelectedPatentFile[],
  deadlines: DeadlineRow[],
  caseVolume: string
): Promise<string> {
  if (!isWriteSwitchOpen()) return '写开关已关闭，没有提交到 EASY。'
  const session = signedIn(host)
  if ('error' in session) return session.error
  if (deadlines.length === 0) return '先查期限，这一轮还没有可提交的事项。'
  const named = volumeList(caseVolume, bucket)
  const picked = named.length
    ? deadlines.filter(row => named.some(volume => row.caseVolume.trim().toLowerCase() === volume.trim().toLowerCase()))
    : deadlines
  if (picked.length === 0) return '这一轮期限结果里没有这些文号。先按文号查期限。'
  const account = await loadAccount(host.area, session.origin, session.operatorId)
  const sheets = account.customers.flatMap(profile => profile.pctTask?.rows ?? [])
  const openIds: string[] = []
  const held: string[] = []
  for (const row of picked) {
    if (!isQueryGuid(row.procId) || !isQueryGuid(row.caseId)) {
      held.push(row.caseVolume || row.procId)
      continue
    }
    const gate = await forward({ type: MessageType.ReadCaseBusFlow, payload: { caseId: row.caseId, procId: row.procId } })
    const state = isMessage(gate) && gate.type === MessageType.CaseBusFlowResult && gate.payload.ok ? gate.payload.data.gate : 'pending'
    if (state === 'open' || state === 'done') openIds.push(row.procId)
    else held.push(row.caseVolume || row.procId)
  }
  if (openIds.length === 0) return `这些事项还在审核里，没有再创建。${held.filter(Boolean).join('、')}`.trim()
  const lead = picked.every(row => {
    const sheet = sheets.find(item => item.ourVolume.trim().toLowerCase() === row.caseVolume.trim().toLowerCase())
    const owner = account.customers.find(profile => profile.pctTask?.rows.some(item => item.ourVolume === sheet?.ourVolume && item.customerName === sheet?.customerName))
    return owner?.pctTask?.recipientMode === 'lead'
  })
  const planned = limitMailItems({
    procIds: openIds,
    rows: picked.map(row => ({ procId: row.procId, caseVolume: row.caseVolume })),
    sheetRows: sheets,
    mode: lead ? 'lead' : 'ipr'
  })
  if (!planned.ok) return planned.message
  const found = await forward({ type: MessageType.SubmitLimitMail, payload: { userId: session.operatorId, items: planned.items } })
  const error = forwardError(found)
  if (error) return error
  if (!isMessage(found) || found.type !== MessageType.SubmitLimitMailResult) return '提交没有返回。'
  const summary = summarizeLimitMailSubmit(found.payload.results, found.payload.stopped)
  if (!summary.startsWith('已提交')) return summary
  return `已提交到 EASY。${summary}`
}

async function createTaskFromSearch(
  host: WorkspaceHost,
  input: { caseVolume: string; applicationNo: string; customerName: string; fileName: string },
  forward: PageForward,
  bucket: SelectedPatentFile[]
): Promise<string> {
  const current = host.connection.context
  if (current.sessionStatus !== 'authenticated' || current.easyTabId == null) return current.message || '还没连上 EASY。先打开已经登录的页面，再重新打开工作台。'
  if (!input.caseVolume && !input.applicationNo && !input.customerName && !input.fileName) return '至少给出文号、申请号、客户或文件名。'
  const found = await forward({
    type: MessageType.SearchFiles,
    payload: {
      query: {
        pageIndex: 1,
        pageSize: 8,
        ...(input.caseVolume ? { caseVolume: input.caseVolume } : {}),
        ...(input.applicationNo ? { applicationNo: input.applicationNo } : {}),
        ...(input.customerName ? { customerName: input.customerName } : {}),
        ...(input.fileName ? { fileName: input.fileName } : {})
      }
    }
  })
  if (!isMessage(found) || found.type !== MessageType.SearchFilesResult) {
    const error = typeof found === 'object' && found !== null && 'error' in found && typeof found.error === 'string' ? found.error : '文件查询没有返回结果。'
    return error
  }
  if (!found.payload.ok) return found.payload.error.message
  const data = found.payload.data
  const selected = data.items.map(selectedFile)
  bucket.splice(0, bucket.length, ...selected.slice(0, 40))
  if (data.items.length === 0) return '没有查到文件，任务还没建。'
  if (data.total > 8) return `对上 ${data.total} 条，一次最多记 8 个文件。把文号或文件名说具体一点再创建。`
  const response = await handleWorkspaceMessage({
    type: MessageType.Workspace,
    payload: {
      action: 'createTaskPlan',
      files: data.items.map(selectedFile),
      queryTemplateVersion: 0,
      expectedScope: {
        easyOrigin: current.easyOrigin,
        operatorId: current.operatorId,
        easyTabId: current.easyTabId,
        connectionVersion: current.connectionVersion
      }
    }
  }, host)
  if (response.type !== MessageType.WorkspaceResult) return '任务没有保存。'
  if (!response.payload.ok) return response.payload.message || '任务没有保存。'
  const count = response.payload.createdTask?.itemCount ?? data.items.length
  return `${response.payload.message}。共 ${count} 个文件。任务在发文任务里，这一步没有提交到 EASY。`
}

/** 工作台的助手请求。probe 只测连通；turn 走工具循环并写入记忆。 */
export async function handleAgentChat(payload: { action?: unknown; message?: unknown }, host: WorkspaceHost): Promise<ApiResult<AgentTurnView>> {
  const area = host.area as LocalArea
  const config = await loadAgentConfig(area)
  const action = payload.action
  if (action === 'history') {
    const memory = await loadMemory(area)
    return { ok: true, data: viewOf('', config.model, 0, memory) }
  }
  if (action === 'reset') return clearConversation(area, config.model)
  if (action === 'facts') {
    const memory = await loadMemory(area)
    return { ok: true, data: viewOf(factsReply(memory), config.model, 0, memory) }
  }
  if (action === 'compact') return compactConversation(area, config)
  if (action === 'stop') {
    stopAgentTurn()
    return { ok: true, data: viewOf('已停下。', config.model, 0, await loadMemory(area)) }
  }
  const message = typeof payload.message === 'string' ? payload.message.trim() : ''
  if (action === 'probe') {
    try {
      const outcome = await chatCompletion(config, {
        messages: [
          { role: 'system', content: '你是 PatMail 的 AI 助手。用一两句简体中文介绍自己。' },
          { role: 'user', content: message }
        ],
        temperature: 0.2
      })
      const reply = outcome.choices[0]?.content?.trim() ?? ''
      if (!reply) return apiError('INVALID_RESPONSE', '模型没有返回内容。')
      return { ok: true, data: viewOf(reply, config.model, 1, await loadMemory(area)) }
    } catch (error) {
      if (error instanceof LlmError) return apiError(error.code, error.message, error.status)
      return apiError('NETWORK_ERROR', 'AI 助手调用没有完成。')
    }
  }
  const resolved = resolveSlash(message)
  if (resolved.kind === 'local' && resolved.local === 'clear') return clearConversation(area, config.model)
  if (resolved.kind === 'local' && resolved.local === 'help') {
    return { ok: true, data: viewOf(helpText(), config.model, 0, await loadMemory(area)) }
  }
  if (resolved.kind === 'local' && resolved.local === 'memory') {
    const memory = await loadMemory(area)
    return { ok: true, data: viewOf(factsReply(memory), config.model, 0, memory) }
  }
  if (resolved.kind === 'local' && resolved.local === 'compact') return compactConversation(area, config)
  if (resolved.kind === 'unknown' || resolved.kind === 'need-args') {
    return { ok: true, data: viewOf(resolved.message, config.model, 0, await loadMemory(area)) }
  }
  const abort = new AbortController()
  turnAbort?.abort()
  turnAbort = abort
  try {
    const turn = await runAgentTurn(config, await loadMemory(area), message, toolContext(host), (next, options) => chatCompletion(next, { ...options, signal: abort.signal }), async state => {
      await saveMemory(area, state)
    }, publishActivity)
    return { ok: true, data: viewOf(turn.reply, config.model, turn.steps, turn.memory) }
  } catch (error) {
    if (error instanceof LlmError) return apiError(error.code, error.message, error.status)
    return apiError('NETWORK_ERROR', 'AI 助手调用没有完成。')
  } finally {
    if (turnAbort === abort) turnAbort = null
  }
}
