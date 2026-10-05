import type { AssistantToolCall } from './llm'

export const AGENT_MEMORY_KEY = 'patmail.agent.memory.v1'

/** 近期原话。超长后旧的几轮收成原文摘录，不整段丢掉。 */
export interface MemoryTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** 点名技能时附给模型的做法。页面上只显示 content。 */
  guidance?: string
  toolCallId?: string
  toolCalls?: AssistantToolCall[]
}

/** 跨会话还在的事实：偏好、常用客户、没做完的交代。 */
export interface MemoryFact {
  id: string
  text: string
  at: string
}

export interface AgentMemoryState {
  summary: string
  turns: MemoryTurn[]
  facts: MemoryFact[]
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
    if (item.role !== 'user' || typeof item.guidance !== 'string' || !item.guidance.trim()) {
      return [{
        role: item.role,
        content: item.content,
        ...(item.toolCallId ? { toolCallId: item.toolCallId } : {}),
        ...(item.toolCalls ? { toolCalls: item.toolCalls } : {})
      }]
    }
    return [{ ...item, guidance: item.guidance.trim().slice(0, 4_000) }]
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
  return { summary, turns: capStoredTurns(turns), facts }
}

export function turnChars(turn: MemoryTurn): number {
  const calls = turn.toolCalls?.reduce((sum, call) => sum + call.function.name.length + call.function.arguments.length, 0) ?? 0
  return turn.content.length + (turn.guidance?.length ?? 0) + calls
}

/** 存在本机缓存里、会交给模型的原文有多长。关掉后台再打开，用同一份记录重算。 */
export function contextChars(state: AgentMemoryState): number {
  return state.summary.length + state.turns.reduce((sum, turn) => sum + turnChars(turn), 0)
}

export async function loadMemory(area: MemoryStorage): Promise<AgentMemoryState> {
  try {
    return normalizeMemory((await area.get(AGENT_MEMORY_KEY))[AGENT_MEMORY_KEY])
  } catch {
    return { ...EMPTY_MEMORY, turns: [], facts: [] }
  }
}

export async function saveMemory(area: MemoryStorage, state: AgentMemoryState): Promise<void> {
  await area.set({ [AGENT_MEMORY_KEY]: normalizeMemory(state) })
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

/** 从原话里摘句子。不改写，避免压缩时编出没出现过的文号或结论。 */
export function digestTurns(turns: MemoryTurn[]): string {
  const lines: string[] = []
  for (const turn of turns) {
    if (turn.role === 'user') {
      const text = oneLine(turn.content, 160)
      if (text) lines.push(`- 用户：${text}`)
      continue
    }
    if (turn.role === 'tool') {
      const text = oneLine(turn.content, 480)
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

/** 页面上只展示人和助手的原话，工具来回留在后台。 */
export function visibleHistory(state: AgentMemoryState): Array<{ role: 'user' | 'assistant'; content: string }> {
  return state.turns.flatMap(turn => {
    if ((turn.role !== 'user' && turn.role !== 'assistant') || !turn.content.trim()) return []
    if (turn.role === 'assistant' && turn.toolCalls && turn.toolCalls.length > 0 && !turn.content.trim()) return []
    return [{ role: turn.role, content: turn.content }]
  }).slice(-160)
}

