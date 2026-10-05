import type { AgentConfig } from './config'
import { chatCompletion, type ChatMessage } from './llm'
import { applySummary, foldDigest, needsCompression, splitForCompression, visibleHistory, type AgentMemoryState } from './memory'
import { resolveSlash } from './slash'
import { agentToolSchemas, executeAgentTool, type ToolContext } from './tools'

const MAX_STEPS = 6
const THOUGHT_MARK = '\u001e'

const TOOL_ACTIVITY: Record<string, string> = {
  connection_status: '正在看连接',
  search_cases: '正在查案件',
  search_deadlines: '正在查期限',
  list_customers: '正在查客户',
  describe_workflows: '正在看工作流',
  list_skills: '正在看本领',
  lookup_api: '正在查接口',
  remember: '正在记下',
  recall: '正在翻记忆',
  create_workflow: '正在建工作流',
  set_workflow_field: '正在改工作流',
  create_task: '正在建任务'
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
  '1. 要建工作流就调用 create_workflow。要改某一栏就调用 set_workflow_field。要建发文任务就调用 create_task。缺了名字或文号，先问一句，问清再做。',
  '2. 查案件、期限、客户和接口，是为了把工作流或任务做对。不要编造文号、客户或日期。',
  '3. 查 EASY 之前先看连接状态。没连上就告诉用户打开已经登录的 EASY 页面，然后重新打开工作台。',
  '4. 创建发文和提交审核不能代点。create_task 只把计划记在发文任务里。',
  '5. 长期记忆里的偏好优先遵守。用户明确的偏好用 remember 记下。文号、客户、日期只有用户亲口说过，或这次工具返回了，才能记住，不要把推断写进去。',
  '6. 用简体中文，先说做成了什么，再列依据。',
  '7. 不确定接口、字段或 Call 时，先用 lookup_api 查文档。问一共有多少接口时，检索词用「多少接口」，只报工具给出的个数。文档篇数不是接口数，不要再写一段分类介绍。查到的内容只说明调用方式，真正办理仍用现有工具。',
  '8. 以 /技能名 开头的是用户点名的技能。说明附在这句后面，只办这一件。',
  '9. 更早对话只留原文摘录，不是查证结论。文号、客户、日期、个数以这次工具返回为准。摘录里没有对应工具原文的，要重新查，不要顺着旧说法补细节。'
].join('\n')

export interface AgentTurnResult {
  reply: string
  steps: number
  memory: AgentMemoryState
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type Complete = typeof chatCompletion

function toChat(state: AgentMemoryState): ChatMessage[] {
  const facts = state.facts.slice(-12).map(fact => `- ${fact.text}`).join('\n')
  const preface = [
    SYSTEM_PROMPT,
    state.summary ? `\n更早对话的原文摘录：\n${state.summary}` : '',
    facts ? `\n长期记忆：\n${facts}` : ''
  ].join('')
  return [
    { role: 'system', content: preface },
    ...state.turns.map((turn): ChatMessage => ({
      role: turn.role,
      content: messageOf(turn),
      ...(turn.toolCallId ? { toolCallId: turn.toolCallId } : {}),
      ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {})
    }))
  ]
}

function messageOf(turn: { role: string; content: string; guidance?: string }): string {
  if (turn.role === 'assistant') return splitAgentReply(turn.content).answer || turn.content
  if (turn.role === 'user' && turn.guidance) return `${turn.content}\n\n${turn.guidance}`
  return turn.content
}

/** 旧轮次按原文摘录收起，不再让模型改写成一段摘要，避免把没查过的事写成已经查到。 */
async function compress(_config: AgentConfig, state: AgentMemoryState, _complete: Complete): Promise<AgentMemoryState> {
  if (!needsCompression(state)) return state
  const { older } = splitForCompression(state)
  if (older.length === 0) return state
  return applySummary(state, foldDigest(state.summary, older))
}

/** 手动收摘录。最近一大段原话照留，缓存还没超出这段时不动。 */
export async function compactAgentMemory(_config: AgentConfig, memory: AgentMemoryState, _complete: Complete = chatCompletion): Promise<{ memory: AgentMemoryState; reply: string }> {
  const { older } = splitForCompression(memory)
  if (older.length === 0) return { memory, reply: '这段对话还没到要收的长度，先不用压。' }
  return { memory: applySummary(memory, foldDigest(memory.summary, older)), reply: '更早的对话已收成原文摘录，最近一大段原话还在。' }
}

/** 思考模式打开时，把思考链放在正文前面。关掉时不展示，避免和等待文案搅在一起。 */
function replyText(choice: { content: string; reasoning?: string }, thinking: boolean): string {
  const answer = choice.content.trim()
  const thought = thinking ? (choice.reasoning ?? '').trim() : ''
  if (!thought || thought === answer) return answer || thought
  if (!answer) return thought
  return `${THOUGHT_MARK}thought${THOUGHT_MARK}${thought}${THOUGHT_MARK}${answer}`
}

/** 一轮用户请求：必要时压缩旧上下文，然后按工具调用循环直到模型给出正文。 */
export async function runAgentTurn(config: AgentConfig, memory: AgentMemoryState, userText: string, ctx: ToolContext, complete: Complete = chatCompletion, onMemory?: (state: AgentMemoryState) => Promise<void>, onActivity?: (label: string, thought?: string) => void): Promise<AgentTurnResult> {
  const resolved = resolveSlash(userText)
  if (resolved.kind === 'local' || resolved.kind === 'unknown' || resolved.kind === 'need-args') {
    return { reply: resolved.message, steps: 0, memory, history: visibleHistory(memory) }
  }
  const content = resolved.kind === 'skill' ? resolved.display : userText
  const guidance = resolved.kind === 'skill' ? resolved.guidance : undefined
  let state: AgentMemoryState = {
    ...memory,
    turns: [...memory.turns, { role: 'user', content, ...(guidance ? { guidance } : {}) }]
  }
  if (needsCompression(state)) onActivity?.('正在整理更早的对话')
  state = await compress(config, state, complete)
  const persist = async (): Promise<void> => { await onMemory?.(state) }
  let steps = 0
  for (; steps < MAX_STEPS; steps += 1) {
    onActivity?.(config.thinking ? '正在思考' : '正在组织回答')
    const outcome = await complete(config, {
      messages: toChat(state),
      tools: agentToolSchemas(),
      temperature: 0.2,
      onDelta: partial => {
        const thought = partial.reasoning.trim()
        if (config.thinking && thought) onActivity?.('正在思考', thought)
      }
    })
    const choice = outcome.choices[0]
    if (!choice) break
    if (choice.toolCalls.length > 0) {
      state = { ...state, turns: [...state.turns, { role: 'assistant', content: choice.content, toolCalls: choice.toolCalls }] }
      for (const call of choice.toolCalls) {
        onActivity?.(toolActivity(call.function.name))
        const executed = await executeAgentTool(call.function.name, call.function.arguments, ctx, state)
        state = executed.memory
        state = { ...state, turns: [...state.turns, { role: 'tool', content: executed.text, toolCallId: call.id }] }
      }
      await persist()
      continue
    }
    const reply = replyText(choice, config.thinking)
    if (!reply) break
    state = { ...state, turns: [...state.turns, { role: 'assistant', content: reply }] }
    await persist()
    return { reply, steps: steps + 1, memory: state, history: visibleHistory(state) }
  }
  const reply = '这轮工具调用已经到上限，先停在这里。可以把要求再说具体一点，或让我只查其中一件。'
  state = { ...state, turns: [...state.turns, { role: 'assistant', content: reply }] }
  await persist()
  return { reply, steps, memory: state, history: visibleHistory(state) }
}
