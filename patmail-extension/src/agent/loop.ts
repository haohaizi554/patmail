import { activityDetail } from './trace'
import type { AgentConfig } from './config'
import { chatCompletion, LlmError, llmFailureKind, type AssistantToolCall, type ChatChoice, type ChatMessage, type ChatOutcome } from './llm'
import { applySummary, contextChars, foldDigest, needsCompression, OVERFLOW_RETRY_CHARS, projectOldToolText, splitForCompression, trimToolResults, visibleHistory, type AgentMemoryState, type MemoryTurn } from './memory'
import { planFromCalls, remainingWork, type WorkStep } from './plan'
import { resolveSlash } from './slash'
import { agentToolSchemas, executeAgentTool, type ToolContext } from './tools'
import { DIGEST_MISS_LIMIT, MAX_NUDGES, RATE_LIMIT_BACKOFF_MS, STEP_LIMIT_REPLY, UNKNOWN_STOP_AT, WRAP_NOTE, asksToSubmit, canonicalArgs, factIsGrounded, failedQueryText, groupToolCalls, isUnknownTool, repeatNote, requiredTools, reviewReply, sameResultAgain, shouldStopFailures, shouldStopRepeat, skippedToolText, stepLimit, stuckQueryText, toolSucceeded, unknownStopNote, type ToolTrace } from './turn-policy'

const THOUGHT_MARK = '\u001e'

const TOOL_ACTIVITY: Record<string, string> = {
  connection_status: '正在看连接',
  search_cases: '正在查案件',
  search_deadlines: '正在查期限',
  list_customers: '正在查客户',
  describe_workflows: '正在看工作流',
  list_skills: '正在看本领',
  lookup_api: '正在查接口',
  call_easy: '正在调用接口',
  ask_user: '正在等你回答',
  plan_work: '正在拆开这几步',
  remember: '正在记下',
  recall: '正在翻记忆',
  create_workflow: '正在建工作流',
  set_workflow_field: '正在改工作流',
  create_task: '正在建任务',
  read_customer: '正在读客户',
  preview_workflow: '正在预览工作流',
  draft_mail: '正在起草',
  list_tasks: '正在列任务',
  list_history: '正在看记录',
  list_reviewers: '正在看审核人',
  list_processes: '正在列流程',
  list_acceptance: '正在看验收',
  readonly_acceptance: '正在做只读验收',
  diagnose_mail: '正在核对邮件',
  export_contacts: '正在导出联系人',
  submit_easy: '正在提交到 EASY'
}

export function toolActivity(name: string): string {
  return TOOL_ACTIVITY[name] ?? '正在办理'
}

function mostlyChinese(text: string): boolean {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  return cjk >= 4 && cjk > latin
}

/** 旧回复把思考写成 **思考** 标题。中文正文从第一段起算，英文推理留在折叠里。 */
function splitLegacyThought(content: string): { thought: string; answer: string } | null {
  const match = content.match(/^\*\*思考\*\*\s*\n+([\s\S]*)$/)
  if (!match) return null
  const parts = match[1].trim().split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  if (parts.length <= 1) return { thought: '', answer: parts[0] ?? '' }
  const index = parts.findIndex(part => mostlyChinese(part))
  if (index > 0) return { thought: parts.slice(0, index).join('\n\n'), answer: parts.slice(index).join('\n\n') }
  return { thought: parts.slice(0, -1).join('\n\n'), answer: parts[parts.length - 1] ?? '' }
}

/** 思考链和正文分开。没有思考时原文照旧。 */
export function splitAgentReply(content: string): { thought: string; answer: string } {
  const head = `${THOUGHT_MARK}thought${THOUGHT_MARK}`
  if (content.startsWith(head)) {
    const rest = content.slice(head.length)
    const cut = rest.indexOf(THOUGHT_MARK)
    if (cut >= 0) return { thought: rest.slice(0, cut), answer: rest.slice(cut + THOUGHT_MARK.length) }
  }
  const tagged = content.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/i)
  if (tagged) return { thought: tagged[1].trim(), answer: tagged[2].trim() }
  const unclosed = content.match(/^<think>([\s\S]*)$/i)
  if (unclosed) return { thought: unclosed[1].trim(), answer: '' }
  return splitLegacyThought(content) ?? { thought: '', answer: content }
}

/** 收起时只露思考的第一行，和 DeepSeek 结算后的摘要一样。 */
export function thoughtLead(thought: string): string {
  const line = thought.split('\n').map(item => item.trim()).find(Boolean) ?? ''
  const plain = line.replace(/^#{1,6}\s*/, '').replace(/[*_`]/g, '')
  return plain.length > 36 ? `${plain.slice(0, 36)}…` : plain
}

const SYSTEM_PROMPT = [
  '你是 PatMail 的执行助手，使用者是不懂接口的专利流程人员。',
  '用户用大白话说要办的事。你调用工具，把工作流和发文任务直接做出来，不要只给一份查询清单。',
  '规则：',
  '1. 要建工作流就调用 create_workflow。要改某一栏就调用 set_workflow_field。要建发文任务就调用 create_task。缺了只有用户知道的名字、文号或步骤时调用 ask_user。问什么、给哪些选项由你决定。用户答完再做。不要只在正文里写还要补上。',
  '2. 查案件、期限、客户和接口，是为了把工作流或任务做对。不要编造文号、客户或日期。',
  '3. 查 EASY 之前先看连接状态。没连上就告诉用户打开已经登录的 EASY 页面，然后重新打开工作台。',
  '4. 用户要提交到 EASY 或提交审核时调用 submit_easy。它和页面上的「提交到 EASY」一样，创建发文并交给当前登录人。写开关关着、事项还在审核里、或还没有发文类型时，按工具原文说明，不要说已经提交。create_task 只记计划。起草、对信、合成一封调用 draft_mail，占位符由这一轮查到的文件填写。看任务、查询记录、客户资料分别调用 list_tasks、list_history、read_customer。',
  '5. 长期记忆里的偏好优先遵守。用户明确的偏好用 remember 记下。文号、客户、日期只有用户亲口说过，或这次工具返回了，才能记住，不要把推断写进去。',
  '6. 用简体中文，先说做成了什么，再列依据。',
  '7. 不确定接口、字段或 Call 时，先用 lookup_api 查文档。用户要看实时响应时调用 call_easy。页面上已经固定的组合用 recipe，只填 case_id：biology 是生物材料，case-info 是案件信息，case-flow 是案件流程，case-demand 是案件要求。其它接口用 steps 按顺序调用，下一步字段用 @{1.路径} 取第 1 步响应里的值。查案件、查期限给出的案件编号和事项编号原样填进去。不要只调一个就停，回答里不要念这些编号。它使用当前登录会话，只发不会改数据的请求。不要说无法调用 HTTP。问一共有多少接口时，检索词用「多少接口」，只报工具给出的个数。文档篇数不是接口数，不要再写一段分类介绍。会改数据的动作仍用现有工具。',
  '8. 以 /技能名 开头的是用户点名的技能。说明附在这句后面，只办这一件。',
  '9. 更早对话只留原文摘录，不是查证结论。文号、客户、日期、个数以这次工具返回为准。摘录里没有对应工具原文的，要重新查，不要顺着旧说法补细节。',
  '10. 一件事要分好几步时，先调用 plan_work，写 2 到 6 步。每步一个短标题，并写上要用的工具名。然后按顺序做，一步成功再做下一步。只查一次的小事不要写计划。'
].join('\n')

export interface AgentTurnResult {
  reply: string
  steps: number
  memory: AgentMemoryState
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type Complete = typeof chatCompletion

function wait(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

function messageOf(turn: { role: string; content: string; guidance?: string }): string {
  if (turn.role === 'assistant') return splitAgentReply(turn.content).answer || turn.content
  if (turn.role === 'user' && turn.guidance) return `${turn.content}\n\n${turn.guidance}`
  return turn.content
}

/** 系统提示保持不变。摘录和长期记忆挂在这一轮的用户消息上，不改已经发出的历史。 */
function toChat(state: AgentMemoryState): ChatMessage[] {
  const facts = state.facts.slice(-12).map(fact => `- ${fact.text}`).join('\n')
  const visibleUsers = state.turns.flatMap((turn, index) => turn.role === 'user' && !turn.hidden ? [index] : [])
  const firstUser = visibleUsers[0]
  const lastUser = visibleUsers[visibleUsers.length - 1]
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...state.turns.map((turn, index): ChatMessage => ({
      role: turn.role,
      content: outgoingContent(turn, index, firstUser, lastUser, state.summary, facts),
      ...(turn.toolCallId ? { toolCallId: turn.toolCallId } : {}),
      ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {})
    }))
  ]
}

function outgoingContent(turn: MemoryTurn, index: number, firstUser: number | undefined, lastUser: number | undefined, summary: string, facts: string): string {
  let text = messageOf(turn)
  if (turn.role === 'tool' && lastUser !== undefined && index < lastUser) return projectOldToolText(text)
  if (turn.role !== 'user' || turn.hidden) return text
  if (index === firstUser && summary) text = `更早对话的原文摘录：\n${summary}\n\n${text}`
  if (index === lastUser && facts) text = `${text}\n\n本轮可以参考的长期记忆：\n${facts}`
  return text
}

function withTool(state: AgentMemoryState, id: string, text: string): AgentMemoryState {
  return { ...state, turns: [...state.turns, { role: 'tool', content: text, toolCallId: id }] }
}

function sealSkipped(state: AgentMemoryState, calls: AssistantToolCall[]): AgentMemoryState {
  return calls.reduce((current, call) => withTool(current, call.id, skippedToolText()), state)
}

/** 先把超长工具结果收成头尾，再摘更早的原话。摘录连续三次没变短就停。 */
async function compress(_config: AgentConfig, state: AgentMemoryState, _complete: Complete): Promise<AgentMemoryState> {
  const trimmed = trimToolResults(state)
  if ((trimmed.digestMisses ?? 0) >= DIGEST_MISS_LIMIT) return trimmed
  if (!needsCompression(trimmed)) return trimmed
  const { older } = splitForCompression(trimmed)
  if (older.length === 0) return { ...trimmed, digestMisses: Math.min(DIGEST_MISS_LIMIT, (trimmed.digestMisses ?? 0) + 1) }
  const next = applySummary(trimmed, foldDigest(trimmed.summary, older))
  if (!next.summary || contextChars(next) >= contextChars(trimmed)) {
    return { ...trimmed, digestMisses: Math.min(DIGEST_MISS_LIMIT, (trimmed.digestMisses ?? 0) + 1) }
  }
  return { ...next, digestMisses: 0 }
}

/** 手动收摘录。最近一大段原话照留，缓存还没超出这段时不动。 */
export async function compactAgentMemory(_config: AgentConfig, memory: AgentMemoryState, _complete: Complete = chatCompletion): Promise<{ memory: AgentMemoryState; reply: string }> {
  const trimmed = trimToolResults(memory)
  const { older } = splitForCompression(trimmed)
  if (older.length === 0) return { memory: trimmed, reply: '这段对话还没到要收的长度，先不用压。' }
  const next = applySummary(trimmed, foldDigest(trimmed.summary, older))
  return { memory: { ...next, digestMisses: 0 }, reply: '更早的对话已收成原文摘录，最近一大段原话还在。' }
}

const SAVED_STEPS = new Set<string>([...Object.values(TOOL_ACTIVITY), '正在办理', '已拆成计划', '连着失败已停下', '重复查询已停下'])

interface JournalEntry { kind: 'thought' | 'step'; text: string; detail: string }

function appendThought(items: JournalEntry[], text: string): void {
  const cleaned = text.trim()
  if (!cleaned) return
  const last = items.at(-1)
  if (last?.kind === 'thought') {
    if (cleaned === last.text || cleaned.startsWith(last.text)) {
      last.text = cleaned
      return
    }
    if (last.text.startsWith(cleaned)) return
  }
  items.push({ kind: 'thought', text: cleaned, detail: '' })
}

function appendStep(items: JournalEntry[], label: string, detail?: string): void {
  if (!SAVED_STEPS.has(label)) return
  if (detail) {
    const open = [...items].reverse().find(item => item.kind === 'step' && item.text === label && !item.detail)
    if (open) {
      open.detail = detail
      return
    }
    items.push({ kind: 'step', text: label, detail })
    return
  }
  const last = items.at(-1)
  if (last?.kind === 'step' && last.text === label && !last.detail) return
  items.push({ kind: 'step', text: label, detail: '' })
}

function renderJournal(items: readonly JournalEntry[]): string {
  const blocks: string[] = []
  let steps: string[] = []
  const flush = (): void => {
    if (steps.length === 0) return
    blocks.push(steps.join('\n'))
    steps = []
  }
  for (const item of items) {
    if (item.kind === 'step') {
      steps.push(item.detail ? `- ${item.text}：${item.detail}` : `- ${item.text}`)
      continue
    }
    flush()
    if (item.text.trim()) blocks.push(item.text.trim())
  }
  flush()
  return blocks.join('\n\n')
}

/** 思考和步骤按发生顺序收成一段。展开后先看到先发生的那一件。 */
export function packJournal(reply: string, journal: readonly JournalEntry[]): string {
  const split = splitAgentReply(reply)
  const answer = (split.answer || reply).trim()
  const items = journal.map(item => ({ ...item }))
  if (split.thought.trim() && split.thought.trim() !== answer) appendThought(items, split.thought)
  const body = renderJournal(items)
  if (!body) return answer
  const clipped = body.length > 12_000 ? body.slice(body.length - 12_000) : body
  return `${THOUGHT_MARK}thought${THOUGHT_MARK}${clipped}${THOUGHT_MARK}${answer}`
}

/** 思考模式打开时，把思考链放在正文前面。正文还没写出来时不把思考当成回复。 */
function replyText(choice: { content: string; reasoning?: string }, thinking: boolean): string {
  const answer = choice.content.trim()
  const thought = thinking ? (choice.reasoning ?? '').trim() : ''
  if (!answer || !thought || thought === answer) return answer
  return `${THOUGHT_MARK}thought${THOUGHT_MARK}${thought}${THOUGHT_MARK}${answer}`
}

/** 模型把推理写进了正文。这种半截独白不能当给用户的回复。 */
function isSelfTalk(text: string): boolean {
  return (text.match(/我应该|让我|规则说|不符合规则|再仔细看/g) ?? []).length >= 3
}

function hitLength(reason: string): boolean {
  return reason === 'length' || reason === 'max_tokens'
}

function thinkLeftOpen(text: string): boolean {
  return /^<think>/i.test(text) && !/<\/think>/i.test(text)
}

function shouldResume(choice: { content: string; reasoning?: string; finishReason: string; toolCalls: unknown[] }, thinking: boolean): boolean {
  if (choice.toolCalls.length > 0) return false
  if (thinkLeftOpen(choice.content) || isSelfTalk(choice.content)) return true
  if (hitLength(choice.finishReason)) return true
  return thinking && !choice.content.trim() && Boolean(choice.reasoning?.trim())
}

/** 半截正文留下来接着写。推理独白不送回去，避免模型顺着独白继续。 */
function resumePartial(choice: { content: string }): string {
  if (!choice.content.trim() || isSelfTalk(choice.content) || thinkLeftOpen(choice.content)) return ''
  return choice.content.trim()
}

function mergeCut(partial: string, next: string): string {
  const head = partial.trim()
  const tail = next.trim()
  if (!head) return tail
  if (!tail) return head
  if (tail.startsWith(head)) return tail
  return /[。！？]$/.test(head) ? `${head}\n${tail}` : `${head}${tail}`
}

function groundSources(state: AgentMemoryState, traces: ToolTrace[], userText: string): string[] {
  const said = state.turns.filter(turn => turn.role === 'user' && !turn.hidden).map(turn => turn.content)
  const found = traces.filter(trace => trace.ok).map(trace => trace.text)
  return [userText, ...said, ...found]
}

interface ToolBatch {
  state: AgentMemoryState
  traces: ToolTrace[]
  unknownStreak: number
  halt: boolean
}

/** 每个工具调用都回一条结果。只读查询同一波一起跑，写操作仍按顺序。重复查询和无此工具在这里停。 */
async function runToolBatch(state: AgentMemoryState, calls: AssistantToolCall[], traces: ToolTrace[], unknownStreak: number, ctx: ToolContext, userText: string, onActivity?: (label: string, thought?: string, detail?: string) => void, compacted = false): Promise<ToolBatch> {
  let next = state
  const seen = traces.map(trace => ({ ...trace }))
  let unknown = unknownStreak
  let halt = false
  const groups = groupToolCalls(calls.map(call => call.function.name))
  for (const group of groups) {
    if (halt) break
    const ready: AssistantToolCall[] = []
    for (const index of group) {
      const call = calls[index]
      if (!call) continue
      const args = canonicalArgs(call.function.arguments)
      if (shouldStopFailures(seen, call.function.name, args)) {
        onActivity?.('连着失败已停下', undefined, activityDetail(failedQueryText(call.function.name)))
        const text = failedQueryText(call.function.name)
        next = withTool(next, call.id, text)
        seen.push({ name: call.function.name, args, text, ok: false })
        next = sealSkipped(next, calls.slice(index + 1))
        halt = true
        break
      }
      if (shouldStopRepeat(seen, call.function.name, args)) {
        onActivity?.('重复查询已停下', undefined, activityDetail(stuckQueryText(call.function.name, args)))
        const text = stuckQueryText(call.function.name, args)
        next = withTool(next, call.id, text)
        seen.push({ name: call.function.name, args, text, ok: false })
        next = sealSkipped(next, calls.slice(index + 1))
        halt = true
        break
      }
      ready.push(call)
    }
    if (ready.length === 0) break
    for (const call of ready) onActivity?.(toolActivity(call.function.name))
    const base = next
    const executed = await Promise.all(ready.map(call => executeAgentTool(call.function.name, call.function.arguments, ctx, base)))
    for (let slot = 0; slot < ready.length; slot += 1) {
      const call = ready[slot]
      const result = executed[slot]
      if (!call || !result) continue
      const args = canonicalArgs(call.function.arguments)
      let text = result.text
      let memory = result.memory
      if (call.function.name === 'remember') {
        const before = new Set(base.facts.map(fact => fact.id))
        const added = memory.facts.filter(fact => !before.has(fact.id))
        const fresh = added.filter(fact => factIsGrounded(fact.text, groundSources(base, seen, userText)))
        if (added.length > 0 && fresh.length !== added.length) {
          memory = { ...memory, facts: [...base.facts, ...fresh] }
          text = fresh.length > 0
            ? `已记住：${fresh.map(fact => fact.text).join('；')}`
            : '这句话不是用户亲口说的，也不是这次工具返回的，没有写入长期记忆。'
        }
      }
      const note = isUnknownTool(text) ? '' : repeatNote(seen, call.function.name, args, text)
      if (isUnknownTool(text)) unknown += 1
      else unknown = 0
      const stopUnknown = unknown >= UNKNOWN_STOP_AT
      const again = compacted && sameResultAgain(seen, call.function.name, args, text)
      const stored = `${text}${note}${again ? '\n整理过更早对话之后，同一结果又出现了一次，不再重复查。' : ''}${stopUnknown ? unknownStopNote() : ''}`
      seen.push({ name: call.function.name, args, text, ok: toolSucceeded(call.function.name, text) })
      onActivity?.(toolActivity(call.function.name), undefined, activityDetail(stored))
      next = { ...memory, turns: [...next.turns, { role: 'tool', content: stored, toolCallId: call.id }] }
      if (again) {
        const lastIndex = calls.indexOf(call)
        next = sealSkipped(next, calls.slice(lastIndex + 1))
        halt = true
        break
      }
      if (stopUnknown) {
        const lastIndex = calls.indexOf(call)
        next = sealSkipped(next, calls.slice(lastIndex + 1))
        halt = true
        break
      }
    }
  }
  return { state: next, traces: seen, unknownStreak: unknown, halt }
}

/** 一轮用户请求：先裁工具结果，再按工具调用循环。正文要过闸门，步数用尽时再要一次不带工具的收尾。 */
export async function runAgentTurn(config: AgentConfig, memory: AgentMemoryState, userText: string, ctx: ToolContext, complete: Complete = chatCompletion, onMemory?: (state: AgentMemoryState) => Promise<void>, onActivity?: (label: string, thought?: string, detail?: string) => void): Promise<AgentTurnResult> {
  const resolved = resolveSlash(userText)
  if (resolved.kind === 'local' || resolved.kind === 'unknown') {
    return { reply: resolved.message, steps: 0, memory, history: visibleHistory(memory) }
  }
  const content = resolved.kind === 'skill' ? resolved.display : userText
  const guidance = resolved.kind === 'skill' ? resolved.guidance : undefined
  const required = requiredTools(content)
  const submitAsked = asksToSubmit(content)
  const factsAtStart = memory.facts
  let state: AgentMemoryState = {
    ...memory,
    turns: [...memory.turns, { role: 'user', content, ...(guidance ? { guidance } : {}) }]
  }
  if (needsCompression(state)) onActivity?.('正在整理更早的对话')
  const summaryBefore = state.summary
  state = trimToolResults(state)
  state = await compress(config, state, complete)
  const compacted = Boolean(state.summary) && state.summary !== summaryBefore
  const persistTranscript = async (): Promise<void> => { await onMemory?.({ ...state, facts: factsAtStart }) }
  let plan: WorkStep[] = []
  const journal: JournalEntry[] = []
  const watch = (label: string, thought?: string, detail?: string): void => {
    onActivity?.(label, thought, detail)
    appendStep(journal, label, detail)
  }
  const finish = async (reply: string, steps: number): Promise<AgentTurnResult> => {
    const packed = packJournal(reply, journal)
    state = { ...state, turns: [...state.turns.filter(turn => !turn.hidden), { role: 'assistant', content: packed }] }
    await onMemory?.(state)
    return { reply: packed, steps, memory: state, history: visibleHistory(state) }
  }
  const ask = async (withTools: boolean, override?: AgentConfig): Promise<ChatOutcome> => {
    const active = override ?? config
    const send = (current: AgentMemoryState): Promise<ChatOutcome> => {
      let thought = ''
      let draft = ''
      let shownThought = ''
      let shownDraft = ''
      let last = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      const pushLive = (force = false): void => {
        const nextThought = thought.trim()
        const nextDraft = draft.trim()
        if ((nextThought === shownThought && nextDraft === shownDraft) || (!nextThought && !nextDraft)) return
        const now = Date.now()
        if (!force && last !== 0 && now - last < 80) {
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; pushLive(true) }, 80)
          return
        }
        if (timer !== undefined) { clearTimeout(timer); timer = undefined }
        last = now
        if (nextThought && nextThought !== shownThought) {
          shownThought = nextThought
          onActivity?.('正在思考', shownThought)
        }
        if (nextDraft && nextDraft !== shownDraft) {
          shownDraft = nextDraft
          onActivity?.('正在写', shownDraft)
        }
      }
      return complete(active, {
        messages: toChat(current),
        ...(withTools ? { tools: agentToolSchemas([...state.turns.filter(turn => turn.role === 'user').map(turn => [turn.content, turn.guidance].filter(Boolean).join('\n')), ...plan.map(step => step.tool)]) } : {}),
        temperature: 0.2,
        onDelta: partial => {
          thought = partial.reasoning.trim()
          draft = partial.content.trim()
          pushLive()
        }
      }).finally(() => pushLive(true))
    }
    let upstreamTries = 0
    let transientTries = 0
    let overflowTries = 0
    for (;;) {
      try {
        return await send(state)
      } catch (error) {
        if (!(error instanceof LlmError)) throw error
        if (error.message === '已停下。') throw error
        const kind = llmFailureKind(error)
        if (kind === 'rate_limit') {
          onActivity?.('模型忙，稍等再试')
          await wait(RATE_LIMIT_BACKOFF_MS)
          return await send(state)
        }
        if (kind === 'transient' && transientTries < 1) {
          transientTries += 1
          onActivity?.('网络不稳，再试一次')
          await wait(RATE_LIMIT_BACKOFF_MS)
          continue
        }
        if (kind === 'upstream' && upstreamTries < 2) {
          upstreamTries += 1
          onActivity?.('模型暂时没接上，再试一次')
          await wait(RATE_LIMIT_BACKOFF_MS)
          continue
        }
        if (kind === 'overflow' && overflowTries < 1) {
          overflowTries += 1
          const next = trimToolResults(state, OVERFLOW_RETRY_CHARS)
          if (contextChars(next) >= contextChars(state)) throw error
          onActivity?.('正在缩短查询结果')
          state = next
          continue
        }
        throw error
      }
    }
  }

  const askOrKeep = async (withTools: boolean, override?: AgentConfig): Promise<ChatOutcome> => {
    try {
      return await ask(withTools, override)
    } catch (error) {
      if (!(error instanceof LlmError) || error.message !== '已停下。') await onMemory?.(state)
      throw error
    }
  }

  const cutShort = '这轮回答写到一半被长度截断了，结论没有写完。再说一次我接着办。'
  const resumeCut = async (choice: ChatChoice): Promise<ChatChoice> => {
    if (!shouldResume(choice, config.thinking)) return choice
    onActivity?.('正在把剩下的写完')
    const partial = resumePartial(choice)
    const note = partial
      ? '上一句被输出长度截断了。从断句接着写完，不要重头再说，不要写思考过程。'
      : '思考已经够了。用简体中文直接给出结论，不要写思考过程。'
    const bookmark = state
    state = {
      ...state,
      turns: [
        ...state.turns,
        ...(partial ? [{ role: 'assistant' as const, content: partial, hidden: true }] : []),
        { role: 'user', content: note, hidden: true }
      ]
    }
    const fallback = (): ChatChoice => (
      partial
        ? { ...choice, content: partial, reasoning: '', finishReason: 'stop' }
        : { ...choice, content: cutShort, reasoning: '', finishReason: 'stop' }
    )
    try {
      const more = await askOrKeep(false, { ...config, thinking: false, maxTokens: Math.max(config.maxTokens, 4096) })
      const next = more.choices[0]
      state = bookmark
      if (!next || next.toolCalls.length > 0 || !next.content.trim() || isSelfTalk(next.content) || thinkLeftOpen(next.content)) return fallback()
      return { ...next, content: partial ? mergeCut(partial, next.content) : next.content.trim(), reasoning: '', finishReason: 'stop' }
    } catch (error) {
      state = bookmark
      if (error instanceof LlmError && error.message === '已停下。') throw error
      return fallback()
    }
  }

  const traces: ToolTrace[] = []
  let unknownStreak = 0
  let candidate = ''
  let nudges = 0
  let steps = 0
  let halt = false
  const toolNames = new Set(agentToolSchemas().map(tool => tool.function.name))
  while (steps < stepLimit(plan.length) && !halt) {
    steps += 1
    onActivity?.(config.thinking ? '正在思考' : '正在组织回答')
    const outcome = await askOrKeep(true)
    const choice = outcome.choices[0]
    if (!choice) { halt = true; break }
    if (choice.toolCalls.length > 0) {
      if (config.thinking) appendThought(journal, choice.reasoning ?? '')
      state = { ...state, turns: [...state.turns, { role: 'assistant', content: choice.content, toolCalls: choice.toolCalls }] }
      const expected = plan[0]
      const batch = await runToolBatch(state, choice.toolCalls, traces, unknownStreak, ctx, content, watch, compacted)
      state = batch.state
      traces.splice(0, traces.length, ...batch.traces)
      unknownStreak = batch.unknownStreak
      halt = batch.halt
      const written = planFromCalls(choice.toolCalls, traces, toolNames)
      if (written) {
        plan = written
        watch('已拆成计划', undefined, written.map((step, index) => `${index + 1}.${step.title}`).join(' '))
      } else if (expected && !choice.toolCalls.some(call => call.function.name === expected.tool)) {
        state = {
          ...state,
          turns: [...state.turns, { role: 'user', content: `计划的下一步是「${expected.title}」，要调用 ${expected.tool}。刚才做的不是这一步。`, hidden: true }]
        }
      }
      await persistTranscript()
      if (halt) break
      continue
    }
    const settled = await resumeCut(choice)
    const reply = replyText(settled, config.thinking)
    if (!reply) { halt = true; break }
    const planLeft = remainingWork(plan, traces).map(step => step.title)
    const gate = reviewReply({ answer: splitAgentReply(reply).answer || reply, required, traces, submitAsked, planLeft })
    if (gate.action === 'nudge' && nudges < MAX_NUDGES) {
      candidate = reply
      nudges += 1
      state = {
        ...state,
        turns: [
          ...state.turns,
          { role: 'assistant', content: reply, hidden: true },
          { role: 'user', content: gate.note, hidden: true }
        ]
      }
      continue
    }
    if (gate.action === 'nudge') {
      candidate = reply
      break
    }
    return finish(reply, steps)
  }
  if (candidate) return finish(candidate, steps)
  onActivity?.('正在整理这轮结果')
  const unfinished = remainingWork(plan, traces).map(step => step.title)
  const wrap = unfinished.length ? `${WRAP_NOTE}\n还没做完：${unfinished.join('、')}。` : WRAP_NOTE
  state = { ...state, turns: [...state.turns, { role: 'user', content: wrap, hidden: true }] }
  try {
    const outcome = await askOrKeep(false)
    const choice = outcome.choices[0]
    const settled = choice && choice.toolCalls.length === 0 ? await resumeCut(choice) : null
    const reply = settled ? replyText(settled, config.thinking) : ''
    if (reply) return finish(reply, steps)
  } catch (error) {
    if (error instanceof LlmError && error.message === '已停下。') throw error
  }
  const stuck = unfinished.length ? `${STEP_LIMIT_REPLY}\n还没做完：${unfinished.join('、')}。` : STEP_LIMIT_REPLY
  return finish(stuck, steps)
}
