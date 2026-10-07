import type { AssistantToolCall } from './llm'
import type { SelectedPatentFile } from '../mail/types'

export const AGENT_MEMORY_KEY = 'patmail.agent.memory.v1'

/** 近期原话。超长后旧的几轮收成原文摘录，不整段丢掉。 */
export interface MemoryTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** 点名技能时附给模型的做法。页面上只显示 content。 */
  guidance?: string
  toolCallId?: string
  toolCalls?: AssistantToolCall[]
  /** 闸门追加的说明。模型要看见，页面上不显示。 */
  hidden?: boolean
}

/** 跨会话还在的事实：偏好、常用客户、没做完的交代。 */
export interface MemoryFact {
  id: string
  text: string
  at: string
}

/** 这一段对话里查到、下一句还能接着用的文件和期限。跟对话走，不跟长期记忆走。 */
export interface AgentDeadlineRef {
  procId: string
  caseId: string
  caseVolume: string
}

export interface AgentWork {
  files: SelectedPatentFile[]
  deadlines: AgentDeadlineRef[]
  fileQuery?: string
  deadlineQuery?: string
}

/** 和文件查询页最大的一页一样。 */
export const AGENT_FILE_KEEP = 100
/** 期限页一次收集时每页 100，这里留两页。 */
export const AGENT_DEADLINE_KEEP = 200

export interface AgentMemoryState {
  summary: string
  turns: MemoryTurn[]
  facts: MemoryFact[]
  /** 原文摘录连续没变短的次数。到 3 次就停，避免同一段反复摘。 */
  digestMisses?: number
  /** 当前这段对话查到的文件和期限。换一段对话就换一份。 */
  work?: AgentWork
}

export const EMPTY_MEMORY: AgentMemoryState = { summary: '', turns: [], facts: [] }

/** Qwen3.6-35B-A3B 原生窗口。按字符估算，中文大约一字一 token，用来提前留出余量。 */
const CONTEXT_WINDOW_CHARS = 262_144
/**
 * 存下来的对话超过这个长度才收摘录。取窗口的四分之三，
 * 给系统提示、工具说明和这一轮回复留位置。Codex 也是快到窗口上限才压。
 */
export const COMPRESS_AT_CHARS = Math.floor(CONTEXT_WINDOW_CHARS * 0.75)
/** 压完后仍把最近这段原话交给模型。Codex 保留大约 6.4 万 token 的最近消息。 */
export const KEEP_RECENT_CHARS = 64_000
/** 极端情况下的存储上限，避免坏数据撑满浏览器缓存。正常在压缩阈值就会收掉。 */
const STORAGE_TURN_CHARS = 240_000
/** 单条工具结果的上限。超出留头尾，诊断经常在末尾。 */
export const TOOL_RESULT_CHARS = 2_400
const TOOL_OMISSION = '\n…中间已省略…\n'

/** 上一轮已经有多行的工具原文，发给模型时只留第一行。头尾裁过的结果保持原样。 */
export function projectOldToolText(text: string): string {
  if (text.includes('中间已省略')) return text
  const lines = text.split('\n').map(item => item.trim()).filter(Boolean)
  const first = lines[0]
  if (!first || lines.length < 2) return text
  return `${first.slice(0, 180)}\n较早的工具原文已收成一行。`
}

export function clipToolResult(text: string, max = TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text
  const tail = Math.min(600, Math.floor(max / 4))
  const head = max - tail - TOOL_OMISSION.length
  if (head < 1) return text.slice(0, max)
  return `${text.slice(0, head)}${TOOL_OMISSION}${text.slice(-tail)}`
}

/** 上下文仍超长时再压一档。已经到这一档还超，就不再重试。 */
export const OVERFLOW_RETRY_CHARS = 800

export function trimToolResults(state: AgentMemoryState, max = TOOL_RESULT_CHARS): AgentMemoryState {
  let changed = false
  const turns = state.turns.map(turn => {
    if (turn.role !== 'tool') return turn
    const content = clipToolResult(turn.content, max)
    if (content === turn.content) return turn
    changed = true
    return { ...turn, content }
  })
  return changed ? { ...state, turns } : state
}
const MAX_FACTS = 60
const MAX_FACT_TEXT = 240

export interface MemoryStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

function isToolCall(value: unknown): value is AssistantToolCall {
  if (typeof value !== 'object' || value === null) return false
  const call = value as Record<string, unknown>
  const fn = call.function
  return typeof call.id === 'string' && call.type === 'function' &&
    typeof fn === 'object' && fn !== null &&
    typeof (fn as Record<string, unknown>).name === 'string' &&
    typeof (fn as Record<string, unknown>).arguments === 'string'
}

function clipText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function readStoredFile(value: unknown): SelectedPatentFile | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const fileId = clipText(row.fileId, 80)
  const fileName = clipText(row.fileName, 300)
  if (!fileId || !fileName) return null
  const file: SelectedPatentFile = {
    fileId,
    fileName,
    fileDescription: clipText(row.fileDescription, 300),
    customerName: clipText(row.customerName, 200)
  }
  const caseId = clipText(row.caseId, 80)
  const caseName = clipText(row.caseName, 300)
  const caseVolume = clipText(row.caseVolume, 80)
  const customerVolume = clipText(row.customerVolume, 80)
  const applicationNo = clipText(row.applicationNo, 80)
  const officialPostDate = clipText(row.officialPostDate, 40)
  if (caseId) file.caseId = caseId
  if (caseName) file.caseName = caseName
  if (caseVolume) file.caseVolume = caseVolume
  if (customerVolume) file.customerVolume = customerVolume
  if (applicationNo) file.applicationNo = applicationNo
  if (officialPostDate) file.officialPostDate = officialPostDate
  return file
}

function readStoredDeadline(value: unknown): AgentDeadlineRef | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const procId = clipText(row.procId, 80)
  const caseVolume = clipText(row.caseVolume, 80)
  if (!procId || !caseVolume) return null
  return { procId, caseId: clipText(row.caseId, 80), caseVolume }
}

function readWork(value: unknown): AgentWork | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const files = Array.isArray(row.files) ? row.files.flatMap(item => {
    const file = readStoredFile(item)
    return file ? [file] : []
  }).slice(0, AGENT_FILE_KEEP) : []
  const deadlines = Array.isArray(row.deadlines) ? row.deadlines.flatMap(item => {
    const deadline = readStoredDeadline(item)
    return deadline ? [deadline] : []
  }).slice(0, AGENT_DEADLINE_KEEP) : []
  const fileQuery = clipText(row.fileQuery, 500)
  const deadlineQuery = clipText(row.deadlineQuery, 500)
  if (files.length === 0 && deadlines.length === 0 && !fileQuery && !deadlineQuery) return undefined
  return {
    files,
    deadlines,
    ...(fileQuery ? { fileQuery } : {}),
    ...(deadlineQuery ? { deadlineQuery } : {})
  }
}

function isTurn(value: unknown): value is MemoryTurn {
  if (typeof value !== 'object' || value === null) return false
  const turn = value as Record<string, unknown>
  if (turn.role !== 'user' && turn.role !== 'assistant' && turn.role !== 'tool') return false
  if (typeof turn.content !== 'string' || turn.content.length > 20_000) return false
  if (turn.toolCallId !== undefined && typeof turn.toolCallId !== 'string') return false
  if (turn.toolCalls !== undefined && !(Array.isArray(turn.toolCalls) && turn.toolCalls.every(isToolCall))) return false
  if (turn.guidance !== undefined && (typeof turn.guidance !== 'string' || turn.guidance.length > 8_000)) return false
  return true
}

export function normalizeMemory(value: unknown): AgentMemoryState {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_MEMORY }
  const record = value as Record<string, unknown>
  const turns = Array.isArray(record.turns) ? record.turns.flatMap((item): MemoryTurn[] => {
    if (!isTurn(item)) return []
    const hidden = item.hidden === true ? { hidden: true as const } : {}
    if (item.role !== 'user' || typeof item.guidance !== 'string' || !item.guidance.trim()) {
      return [{
        role: item.role,
        content: item.content,
        ...(item.toolCallId ? { toolCallId: item.toolCallId } : {}),
        ...(item.toolCalls ? { toolCalls: item.toolCalls } : {}),
        ...hidden
      }]
    }
    return [{ ...item, guidance: item.guidance.trim().slice(0, 4_000), ...hidden }]
  }) : []
  const facts = Array.isArray(record.facts) ? record.facts.flatMap((item): MemoryFact[] => {
    if (typeof item !== 'object' || item === null) return []
    const fact = item as Record<string, unknown>
    if (typeof fact.id !== 'string' || typeof fact.text !== 'string' || typeof fact.at !== 'string') return []
    const text = fact.text.trim().slice(0, MAX_FACT_TEXT)
    if (!text) return []
    return [{ id: fact.id.slice(0, 80), text, at: fact.at.slice(0, 40) }]
  }).slice(-MAX_FACTS) : []
  const summary = typeof record.summary === 'string' ? record.summary.slice(0, 4_000) : ''
  const misses = typeof record.digestMisses === 'number' && Number.isFinite(record.digestMisses)
    ? Math.max(0, Math.min(3, Math.floor(record.digestMisses)))
    : 0
  const work = readWork(record.work)
  return { summary, turns: capStoredTurns(turns), facts, ...(misses > 0 ? { digestMisses: misses } : {}), ...(work ? { work } : {}) }
}

/** 发给模型的助手原文。思考和步骤留在页面上，不计入这段长度。 */
export function modelAnswer(content: string): string {
  const head = '\u001ethought\u001e'
  if (!content.startsWith(head)) return content
  const rest = content.slice(head.length)
  const cut = rest.indexOf('\u001e')
  return cut >= 0 ? rest.slice(cut + 1) : ''
}

export function turnChars(turn: MemoryTurn): number {
  const calls = turn.toolCalls?.reduce((sum, call) => sum + call.function.name.length + call.function.arguments.length, 0) ?? 0
  const content = turn.role === 'assistant' ? modelAnswer(turn.content) : turn.content
  return content.length + (turn.guidance?.length ?? 0) + calls
}

/** 存在本机缓存里、会交给模型的原文有多长。关掉后台再打开，用同一份记录重算。 */
export function contextChars(state: AgentMemoryState): number {
  return state.summary.length + state.turns.reduce((sum, turn) => sum + turnChars(turn), 0)
}

/** 会话目录。每段对话一份原文，长期记忆放在目录上，各段共用。 */
export const AGENT_SESSIONS_KEY = 'patmail.agent.sessions.v1'
/** 新建对话时要不要先问名字。存在本机，和某一段对话无关。 */
export const AGENT_ASK_SESSION_NAME_KEY = 'patmail.agent.askSessionName'
const SESSION_PREFIX = 'patmail.agent.session.v1.'
export const MAX_AGENT_SESSIONS = 30
const SESSION_TITLE_LIMIT = 24

export interface AgentSessionInfo {
  id: string
  title: string
  updatedAt: string
  active: boolean
}

export interface AgentSessionSnapshot {
  memory: AgentMemoryState
  sessions: AgentSessionInfo[]
  activeId: string
}

interface SessionMeta { id: string; title: string; updatedAt: string; named?: boolean }
interface SessionIndex { activeId: string; facts: MemoryFact[]; items: SessionMeta[] }

function sessionKey(id: string): string {
  return `${SESSION_PREFIX}${id}`
}

function newSessionId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return raw.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)
}

export function sessionTitleFrom(turns: readonly MemoryTurn[]): string {
  const first = turns.find(turn => turn.role === 'user' && !turn.hidden && turn.content.trim())
  if (!first) return '新对话'
  return clipSessionTitle(first.content)
}

/** 用户起的名字。空的表示还没起，列表里继续叫「新对话」。 */
export function clipSessionTitle(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim()
  if (!line) return '新对话'
  return line.length > SESSION_TITLE_LIMIT ? `${line.slice(0, SESSION_TITLE_LIMIT)}…` : line
}

function sessionBody(state: AgentMemoryState): Pick<AgentMemoryState, 'summary' | 'turns' | 'digestMisses' | 'work'> {
  const normalized = normalizeMemory(state)
  return {
    summary: normalized.summary,
    turns: normalized.turns,
    ...(normalized.digestMisses ? { digestMisses: normalized.digestMisses } : {}),
    ...(normalized.work ? { work: normalized.work } : {})
  }
}

function transcriptEmpty(state: AgentMemoryState): boolean {
  return !state.summary && state.turns.every(turn => turn.hidden || !turn.content.trim())
}

function parseMeta(value: unknown): SessionMeta | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !/^[A-Za-z0-9-]{8,40}$/.test(row.id)) return null
  const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim().slice(0, 40) : '新对话'
  const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt.slice(0, 40) : ''
  return { id: row.id, title, updatedAt, ...(row.named === true ? { named: true } : {}) }
}

function parseIndex(value: unknown): SessionIndex | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.items)) return null
  const items = record.items.flatMap((item): SessionMeta[] => {
    const meta = parseMeta(item)
    return meta ? [meta] : []
  }).slice(0, MAX_AGENT_SESSIONS)
  const activeId = typeof record.activeId === 'string' ? record.activeId : ''
  if (!items.some(item => item.id === activeId)) return null
  return { activeId, items, facts: normalizeMemory({ facts: record.facts }).facts }
}

function cardsOf(index: SessionIndex): AgentSessionInfo[] {
  return [...index.items]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(item => ({ ...item, active: item.id === index.activeId }))
}

async function readBody(area: MemoryStorage, id: string): Promise<AgentMemoryState> {
  try {
    return normalizeMemory((await area.get(sessionKey(id)))[sessionKey(id)])
  } catch {
    return { ...EMPTY_MEMORY, turns: [], facts: [] }
  }
}

async function ensureIndex(area: MemoryStorage): Promise<SessionIndex> {
  let stored: unknown
  try {
    stored = (await area.get(AGENT_SESSIONS_KEY))[AGENT_SESSIONS_KEY]
  } catch {
    stored = undefined
  }
  const parsed = parseIndex(stored)
  if (parsed) return parsed
  let legacy = { ...EMPTY_MEMORY, turns: [] as MemoryTurn[], facts: [] as MemoryFact[] }
  try {
    legacy = normalizeMemory((await area.get(AGENT_MEMORY_KEY))[AGENT_MEMORY_KEY])
  } catch { /* 旧记录读不到时从空对话开始 */ }
  const now = new Date().toISOString()
  const id = newSessionId()
  const index: SessionIndex = {
    activeId: id,
    facts: legacy.facts,
    items: [{ id, title: sessionTitleFrom(legacy.turns), updatedAt: now }]
  }
  await area.set({
    [AGENT_SESSIONS_KEY]: index,
    [sessionKey(id)]: sessionBody(legacy),
    [AGENT_MEMORY_KEY]: null
  })
  return index
}

async function snapshot(area: MemoryStorage, index: SessionIndex): Promise<AgentSessionSnapshot> {
  const body = await readBody(area, index.activeId)
  return {
    memory: { ...body, facts: index.facts },
    sessions: cardsOf(index),
    activeId: index.activeId
  }
}

export async function readAgentSessions(area: MemoryStorage): Promise<AgentSessionSnapshot> {
  return snapshot(area, await ensureIndex(area))
}

export async function loadMemory(area: MemoryStorage): Promise<AgentMemoryState> {
  return (await readAgentSessions(area)).memory
}

export async function saveMemory(area: MemoryStorage, state: AgentMemoryState): Promise<void> {
  const index = await ensureIndex(area)
  const now = new Date().toISOString()
  const next: SessionIndex = {
    activeId: index.activeId,
    facts: normalizeMemory({ facts: state.facts }).facts,
    items: index.items.map(item => {
      if (item.id !== index.activeId) return item
      const title = item.named ? item.title : sessionTitleFrom(state.turns)
      return { id: item.id, title, updatedAt: now, ...(item.named ? { named: true as const } : {}) }
    })
  }
  await area.set({
    [AGENT_SESSIONS_KEY]: next,
    [sessionKey(index.activeId)]: sessionBody(state)
  })
}

/** 当前这段还没有内容时不另开。满了就停，避免把更早的对话悄悄丢掉。有名字就固定下来，不再被第一句话替换。 */
export async function createAgentSession(area: MemoryStorage, title = ''): Promise<AgentSessionSnapshot & { message: string }> {
  const index = await ensureIndex(area)
  const current = await snapshot(area, index)
  if (transcriptEmpty(current.memory)) return { ...current, message: '这段对话还是空的，直接说就行。' }
  if (index.items.length >= MAX_AGENT_SESSIONS) {
    return { ...current, message: `对话已经有 ${MAX_AGENT_SESSIONS} 段，先删掉不用的再开新的。` }
  }
  const now = new Date().toISOString()
  const id = newSessionId()
  const named = title.replace(/\s+/g, ' ').trim().length > 0
  const next: SessionIndex = {
    activeId: id,
    facts: index.facts,
    items: [...index.items, { id, title: named ? clipSessionTitle(title) : '新对话', updatedAt: now, ...(named ? { named: true } : {}) }]
  }
  await area.set({
    [AGENT_SESSIONS_KEY]: next,
    [sessionKey(id)]: sessionBody(EMPTY_MEMORY)
  })
  return { ...(await snapshot(area, next)), message: '新对话已打开。之前的对话还在列表里，长期记忆是共用的。' }
}

export async function openAgentSession(area: MemoryStorage, id: string): Promise<AgentSessionSnapshot & { message: string }> {
  const index = await ensureIndex(area)
  if (!index.items.some(item => item.id === id)) {
    const current = await snapshot(area, index)
    return { ...current, message: '没有这段对话。' }
  }
  const next: SessionIndex = { ...index, activeId: id }
  await area.set({ [AGENT_SESSIONS_KEY]: next })
  return { ...(await snapshot(area, next)), message: '' }
}

/** 改列表里的名字。改过之后，第一句话不再覆盖它。 */
export async function renameAgentSession(area: MemoryStorage, id: string, title: string): Promise<AgentSessionSnapshot & { message: string }> {
  const index = await ensureIndex(area)
  if (!index.items.some(item => item.id === id)) {
    const current = await snapshot(area, index)
    return { ...current, message: '没有这段对话。' }
  }
  const named = title.replace(/\s+/g, ' ').trim().length > 0
  if (!named) {
    const current = await snapshot(area, index)
    return { ...current, message: '名字不能是空的。' }
  }
  const next: SessionIndex = {
    ...index,
    items: index.items.map(item => item.id === id ? { ...item, title: clipSessionTitle(title), named: true } : item)
  }
  await area.set({ [AGENT_SESSIONS_KEY]: next })
  return { ...(await snapshot(area, next)), message: '' }
}

/** 删的是这一段的上下文。长期记忆留在目录上。最后一段删掉后留一个空对话。 */
export async function removeAgentSession(area: MemoryStorage, id: string): Promise<AgentSessionSnapshot & { message: string }> {
  const index = await ensureIndex(area)
  if (!index.items.some(item => item.id === id)) {
    const current = await snapshot(area, index)
    return { ...current, message: '没有这段对话。' }
  }
  const rest = index.items.filter(item => item.id !== id)
  let activeId = index.activeId
  const created: SessionMeta[] = []
  if (rest.length === 0) {
    const now = new Date().toISOString()
    const fresh = { id: newSessionId(), title: '新对话', updatedAt: now }
    created.push(fresh)
    rest.push(fresh)
    activeId = fresh.id
  } else if (activeId === id) {
    activeId = [...rest].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id ?? rest[0].id
  }
  const next: SessionIndex = { activeId, facts: index.facts, items: rest }
  await area.set({
    [AGENT_SESSIONS_KEY]: next,
    [sessionKey(id)]: null,
    ...(created[0] ? { [sessionKey(created[0].id)]: sessionBody(EMPTY_MEMORY) } : {})
  })
  return { ...(await snapshot(area, next)), message: '这段对话已删除。长期记忆还在。' }
}

export function needsCompression(state: AgentMemoryState): boolean {
  return contextChars(state) > COMPRESS_AT_CHARS
}

/**
 * 按缓存长度留下最近一大段原话。从末尾往前量，工具调用和它的返回必须留在同一边。
 */
export function splitForCompression(state: AgentMemoryState, keepChars = KEEP_RECENT_CHARS): { older: MemoryTurn[]; recent: MemoryTurn[] } {
  const turns = state.turns
  let size = 0
  let start = turns.length
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const cost = turnChars(turns[index])
    if (size > 0 && size + cost > keepChars) break
    size += cost
    start = index
  }
  while (start > 0 && turns[start]?.role === 'tool') start -= 1
  return { older: turns.slice(0, start), recent: turns.slice(start) }
}

function capStoredTurns(turns: MemoryTurn[]): MemoryTurn[] {
  if (contextChars({ summary: '', turns, facts: [] }) <= STORAGE_TURN_CHARS) return turns
  return splitForCompression({ summary: '', turns, facts: [] }, STORAGE_TURN_CHARS).recent
}

const DIGEST_NOTE = '以下是更早对话的原文摘录，不是查证结论。摘录里没有的文号、客户、日期和数量都不能当成已经查到。'
const DIGEST_LINE = /^- (用户：|工具原文：|调用了：|助手说过：)/

function oneLine(text: string, limit: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

/** 旧工具摘录里的文号和长编号不留给后面的轮次照抄。 */
function redactOldEvidence(text: string): string {
  return text.replace(/ZL\d{6,}/gi, '文号已略').replace(/\b\d{10,}\b/g, '编号已略')
}

/** 从原话里摘句子。不改写，避免压缩时编出没出现过的文号或结论。 */
export function digestTurns(turns: MemoryTurn[]): string {
  const lines: string[] = []
  for (const turn of turns) {
    if (turn.hidden) continue
    if (turn.role === 'user') {
      const text = oneLine(turn.content, 160)
      if (text) lines.push(`- 用户：${text}`)
      continue
    }
    if (turn.role === 'tool') {
      const text = oneLine(redactOldEvidence(turn.content), 480)
      if (text) lines.push(`- 工具原文：${text}`)
      continue
    }
    if (turn.toolCalls?.length) {
      lines.push(`- 调用了：${turn.toolCalls.map(call => call.function.name).join('、')}`)
      continue
    }
    const answer = oneLine(turn.content.replace(/\u001ethought\u001e[\s\S]*?\u001e/g, ''), 120)
    if (answer && !answer.startsWith('**思考**')) lines.push(`- 助手说过：${answer}`)
  }
  return lines.join('\n')
}

/** 只保留上次摘录里的原文行，再接上新丢掉的原话。自由发挥的旧摘要整段丢掉。 */
export function foldDigest(previous: string, older: MemoryTurn[]): string {
  const kept = previous.split('\n').map(line => line.trim()).filter(line => DIGEST_LINE.test(line))
  const added = digestTurns(older).split('\n').filter(Boolean)
  const lines = [...kept, ...added]
  while (lines.length > 1 && lines.join('\n').length > 3_000) lines.shift()
  if (lines.length === 0) return ''
  return `${DIGEST_NOTE}\n${lines.join('\n')}`
}

export function applySummary(state: AgentMemoryState, summary: string): AgentMemoryState {
  const text = summary.trim().slice(0, 4_000)
  if (!text) return state
  const { recent } = splitForCompression(state)
  return { ...state, summary: text, turns: recent }
}

export function rememberFact(state: AgentMemoryState, text: string, now = new Date().toISOString()): AgentMemoryState {
  const cleaned = text.trim().replace(/\s+/g, ' ').slice(0, MAX_FACT_TEXT)
  if (!cleaned) return state
  if (state.facts.some(fact => fact.text === cleaned)) return state
  const id = globalThis.crypto?.randomUUID?.() ?? `fact-${state.facts.length + 1}`
  return { ...state, facts: [...state.facts, { id, text: cleaned, at: now }].slice(-MAX_FACTS) }
}

export function searchFacts(state: AgentMemoryState, query: string): MemoryFact[] {
  const needle = query.trim().toLowerCase()
  const matched = needle ? state.facts.filter(fact => fact.text.toLowerCase().includes(needle)) : state.facts
  return matched.slice(-12)
}

function factTerms(text: string): string[] {
  const terms: string[] = []
  for (const match of text.toLowerCase().matchAll(/[a-z0-9]{2,}/g)) terms.push(match[0])
  for (const run of text.matchAll(/[\u4e00-\u9fff]+/g)) {
    const chars = [...run[0]]
    for (let index = 0; index < chars.length - 1; index += 1) terms.push(`${chars[index] ?? ''}${chars[index + 1] ?? ''}`)
  }
  return terms
}

/** 和这句话对得上的长期记忆，再补上最近几条。最多 12 条。 */
export function factsForPrompt(state: AgentMemoryState, query: string): MemoryFact[] {
  const asked = new Set(factTerms(query))
  const matched = state.facts.filter(fact => factTerms(fact.text).some(term => asked.has(term))).slice(-8)
  const picked: MemoryFact[] = []
  const seen = new Set<string>()
  for (const fact of [...matched, ...state.facts.slice(-4)]) {
    if (seen.has(fact.id)) continue
    seen.add(fact.id)
    picked.push(fact)
    if (picked.length >= 12) break
  }
  return picked
}

/** 页面上只展示人和助手的原话，工具来回留在后台。 */
export function visibleHistory(state: AgentMemoryState): Array<{ role: 'user' | 'assistant'; content: string }> {
  return state.turns.flatMap(turn => {
    if (turn.hidden) return []
    if ((turn.role !== 'user' && turn.role !== 'assistant') || !turn.content.trim()) return []
    if (turn.role === 'assistant' && turn.toolCalls && turn.toolCalls.length > 0 && !turn.content.trim()) return []
    return [{ role: turn.role, content: turn.content }]
  }).slice(-160)
}

