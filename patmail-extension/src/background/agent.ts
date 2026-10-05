import { apiError, type ApiResult } from '../api/types'
import { loadAgentConfig, type AgentConfig } from '../agent/config'
import { LlmError, chatCompletion } from '../agent/llm'
import { compactAgentMemory, runAgentTurn } from '../agent/loop'
import { loadMemory, saveMemory, visibleHistory, type AgentMemoryState } from '../agent/memory'
import { helpText, resolveSlash } from '../agent/slash'
import type { ToolContext } from '../agent/tools'
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
  return {
    snapshot: () => ({
      connected: host.connection.context.sessionStatus === 'authenticated',
      displayName: host.connection.context.displayName,
      origin: host.connection.context.easyOrigin,
      message: host.connection.context.message
    }),
    async forward(message: ContentRequest): Promise<unknown> {
      const response = await handleWorkspaceMessage({ type: MessageType.Workspace, payload: { action: 'forward', message } }, host)
      if (response.type !== MessageType.WorkspaceResult) return { error: '后台没有转发。' }
      if (!response.payload.ok || !response.payload.forwarded) return { error: response.payload.message || '没有结果。' }
      if (!isMessage(response.payload.forwarded)) return { error: 'EASY 页面没有返回可识别的结果。' }
      return response.payload.forwarded
    },
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
    createTask: input => createTaskFromSearch(host, input)
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

async function createTaskFromSearch(host: WorkspaceHost, input: { caseVolume: string; applicationNo: string; customerName: string; fileName: string }): Promise<string> {
  const current = host.connection.context
  if (current.sessionStatus !== 'authenticated' || current.easyTabId == null) return current.message || '还没连上 EASY。先打开已经登录的页面，再重新打开工作台。'
  if (!input.caseVolume && !input.applicationNo && !input.customerName && !input.fileName) return '至少给出文号、申请号、客户或文件名。'
  const found = await toolContext(host).forward({
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
