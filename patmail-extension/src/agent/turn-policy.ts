/** 短流程 6 步。模型写下计划后，按步数放宽，最多 16 步。 */

export const MAX_STEPS = 6
export const PLAN_STEP_CAP = 16
export const MAX_NUDGES = 2
export const STALL_WARN_AT = 3
export const STALL_STOP_AT = 5
export const UNKNOWN_STOP_AT = 3
export const DIGEST_MISS_LIMIT = 3
export const RATE_LIMIT_BACKOFF_MS = 1_000

export const STEP_LIMIT_REPLY = '这轮工具调用已经到上限，先停在这里。可以把要求再说具体一点，或让我只办其中几步。'

/** 没有计划时仍是 6 步。写下 2 步及以上的计划后，每步再留一次回旋，封顶 16。 */
export function stepLimit(planLength: number): number {
  if (planLength < 2) return MAX_STEPS
  return Math.min(PLAN_STEP_CAP, MAX_STEPS + planLength * 2)
}
export const WRAP_NOTE = '根据已经发生的工具原文，用简体中文说明做成了什么、停在哪里。不要调用工具。有失败就先说哪一步没成。'

export interface ToolTrace {
  name: string
  args: string
  text: string
  ok: boolean
}

export function canonicalArgs(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return trimmed
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(parsed as Record<string, unknown>).sort()) sorted[key] = (parsed as Record<string, unknown>)[key]
    return JSON.stringify(sorted)
  } catch {
    return trimmed
  }
}

/** 在问做法，不是在让人动手。旁边有「帮我」时仍按要办来处理。 */
function askingHow(userText: string): boolean {
  return /怎么|如何|怎样/.test(userText) && !/帮我|给我|请你|麻烦/.test(userText)
}

export function requiredTools(userText: string): string[] {
  if (askingHow(userText)) return []
  const tools: string[] = []
  if (/(?:建|创建|新建|做)(?:一条|一个|个)?工作流/.test(userText)) tools.push('create_workflow')
  if (/(?:改|修改).{0,24}(?:栏|字段)|(?:栏|字段).{0,12}(?:改成|修改)/.test(userText)) tools.push('set_workflow_field')
  if (/发文任务|(?:建|创建|新建)(?:一条|一个|个)?任务/.test(userText)) tools.push('create_task')
  if (/起草|对上要发的信|对信|合成一封|几件合成/.test(userText)) tools.push('draft_mail')
  if (/任务列表|有哪些任务|看看任务|查看任务/.test(userText)) tools.push('list_tasks')
  if (/查询记录|历史查询|记录页/.test(userText)) tools.push('list_history')
  if (/客户资料|这位客户|客户配置/.test(userText)) tools.push('read_customer')
  if (asksToSubmit(userText) || /提交到 EASY|执行这个任务|执行任务/.test(userText)) tools.push('submit_easy')
  return tools
}

export function asksToSubmit(userText: string): boolean {
  if (/发文任务|(?:建|创建|新建)(?:一条|一个|个)?任务/.test(userText) && !/提交审核|代点|代我点/.test(userText)) return false
  return /提交审核|代点|代我点|帮我提交/.test(userText)
}

const FAILURE_HINT = /没有|尚未|还没|先查|先停|先按|写开关已关闭|请给出|至少给出|无效|没连上|未连接|这句话不是|计划要写|问题没有|现在没有|一次最多|未对上/

const KNOWN_TOOLS = new Set([
  'connection_status', 'search_cases', 'search_deadlines', 'list_customers', 'list_skills', 'recall',
  'lookup_api', 'call_easy', 'describe_workflows', 'remember', 'create_workflow', 'set_workflow_field',
  'create_task', 'read_customer', 'preview_workflow', 'draft_mail', 'list_tasks', 'list_history',
  'list_reviewers', 'list_processes', 'list_acceptance', 'readonly_acceptance', 'diagnose_mail',
  'export_contacts', 'ask_user', 'plan_work', 'submit_easy'
])

export function toolSucceeded(name: string, text: string): boolean {
  if (/^(没有这个工具|工具参数不是有效 JSON|工具没有完成)/.test(text)) return false
  if (name === 'list_customers' || name === 'list_skills' || name === 'recall') return true
  if (name === 'lookup_api') return !text.startsWith('请给出')
  if (name === 'describe_workflows') return !text.startsWith('没有对上的工作流')
  if (name === 'connection_status' && text.startsWith('已连接')) return true
  if (name === 'search_cases' && text.startsWith('文件查询共')) return true
  if (name === 'search_deadlines' && text.startsWith('期限监控共')) return true
  if (name === 'call_easy' && text.startsWith('已用当前登录会话调用')) return true
  if (name === 'remember' && (text.startsWith('已记住') || text.startsWith('这句话已经在长期记忆'))) return true
  if ((name === 'create_workflow' || name === 'set_workflow_field') && text.startsWith('已')) return true
  if (name === 'create_task' && (text.includes('没有提交到 EASY') || text.startsWith('已记下') || text.startsWith('已建'))) return true
  if (name === 'read_customer' && text.startsWith('客户 ')) return true
  if (name === 'preview_workflow' && text.startsWith('工作流预览')) return true
  if (name === 'draft_mail' && text.startsWith('起草完成')) return true
  if (name === 'list_tasks' && text.startsWith('发文任务共')) return true
  if (name === 'list_history' && text.startsWith('查询记录共')) return true
  if (name === 'list_reviewers' && text.startsWith('审核人共')) return true
  if (name === 'list_processes' && text.startsWith('流程共')) return true
  if (name === 'list_acceptance' && text.startsWith('验收共')) return true
  if (name === 'readonly_acceptance' && text.startsWith('只读验收 ')) return true
  if (name === 'diagnose_mail' && text.startsWith('邮件核对 ')) return true
  if (name === 'export_contacts' && text.startsWith('联系人共')) return true
  if (name === 'ask_user' && text.startsWith('用户答：')) return true
  if (name === 'plan_work' && text.startsWith('计划已写下')) return true
  if (name === 'submit_easy' && text.startsWith('已提交到 EASY')) return true
  if (FAILURE_HINT.test(text)) return false
  return KNOWN_TOOLS.has(name) && text.trim().length > 0
}

export function requirementsMet(required: string[], traces: ToolTrace[]): boolean {
  return required.every(name => traces.some(trace => trace.name === name && trace.ok))
}

export function isUnknownTool(text: string): boolean {
  return text.startsWith('没有这个工具')
}

function sameTraces(traces: ToolTrace[], name: string, args: string): ToolTrace[] {
  return traces.filter(trace => trace.name === name && trace.args === args)
}

/** 会改本轮缓存或会写数据的工具独占。查案件、查期限和查接口可以跟别的只读查询同一波。 */
const EXCLUSIVE_TOOLS = new Set(['remember', 'create_workflow', 'set_workflow_field', 'create_task', 'draft_mail', 'submit_easy', 'call_easy', 'ask_user', 'plan_work'])

export function groupToolCalls(names: readonly string[]): number[][] {
  const groups: number[][] = []
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index] ?? ''
    const last = groups[groups.length - 1]
    const sameSearch = (name === 'search_cases' || name === 'search_deadlines') && Boolean(last?.some(item => names[item] === name))
    if (!last || EXCLUSIVE_TOOLS.has(name) || last.some(item => EXCLUSIVE_TOOLS.has(names[item] ?? '')) || sameSearch) groups.push([index])
    else last.push(index)
  }
  return groups
}

/** 同一参数连续无进展，第 5 次不再执行。结果还在变就放行。 */
export function shouldStopRepeat(traces: ToolTrace[], name: string, args: string): boolean {
  const same = sameTraces(traces, name, args)
  if (same.length < STALL_STOP_AT - 1) return false
  const last = same[same.length - 1]
  const previous = same[same.length - 2]
  return Boolean(last && previous && last.text === previous.text)
}

export function stuckQueryText(name: string, args: string): string {
  const shown = args ? `，参数 ${args.slice(0, 180)}` : ''
  return `同一查询重复了 ${STALL_STOP_AT} 次，结果没有变化。卡在 ${name}${shown}。`
}

/** 同一参数最近两次都失败，第三次不再发。 */
export function shouldStopFailures(traces: ToolTrace[], name: string, args: string): boolean {
  const same = sameTraces(traces, name, args)
  if (same.length < 2) return false
  return same.slice(-2).every(item => !item.ok)
}

export function failedQueryText(name: string): string {
  return `同一查询已经连着失败 2 次，先停在 ${name}。换个条件，或说明卡在这里。`
}

/** 整理过更早对话之后，同一工具、同一参数、同一结果再出现一次就停。 */
export function sameResultAgain(traces: ToolTrace[], name: string, args: string, text: string): boolean {
  return traces.some(item => item.name === name && item.args === args && item.text === text)
}

/** 第 3 次相同结果加一句警告。参数变了但结果没变，只警告，仍放行。 */
export function repeatNote(traces: ToolTrace[], name: string, args: string, text: string): string {
  const same = sameTraces(traces, name, args)
  const previousSame = same[same.length - 1]
  if (same.length >= STALL_WARN_AT - 1 && previousSame?.text === text) {
    return `\n同一查询已经第 ${same.length + 1} 次，结果没有变化。可以换条件，或停下来说明卡在这里。`
  }
  const previous = [...traces].reverse().find(trace => trace.name === name)
  if (previous && previous.args !== args && previous.text === text) return '\n参数变了，查出来仍一样。这一次先放行。'
  return ''
}

export function skippedToolText(): string {
  return '这一轮已经停下，这条没有执行。'
}

export function unknownStopNote(): string {
  return '\n未知工具已经连续 3 次，这一轮停在这里。'
}

const ADMITS_FAILURE = /没查|没有查|没办成|没有办成|没连上|还没连|还没查|还没办|还没成|尚未连接|尚未登录|失败|无法|未完成|做不到|停在|没成|没有成功|未成功/
const CLAIMS_SUBMIT = /已提交审核|已经提交审核|已代点|已经代点|已创建发文/

export function reviewReply(input: { answer: string; required: string[]; traces: ToolTrace[]; submitAsked: boolean; planLeft?: string[] }): { action: 'accept' } | { action: 'nudge'; note: string } {
  if (input.submitAsked && CLAIMS_SUBMIT.test(input.answer) && !input.traces.some(trace => trace.name === 'submit_easy' && trace.ok)) {
    return { action: 'nudge', note: '去调用 submit_easy。写开关开着才会真正提交到 EASY。没有成功之前，不要说已经提交。' }
  }
  if (input.traces.some(trace => !trace.ok) && !ADMITS_FAILURE.test(input.answer)) {
    return { action: 'nudge', note: '这一轮有工具没有办成。先说哪一步没成，不要说已经办成。' }
  }
  if (input.required.length > 0 && !requirementsMet(input.required, input.traces)) {
    const missing = input.required.filter(name => !input.traces.some(trace => trace.name === name && trace.ok))
    return { action: 'nudge', note: `去调用工具，不要只叙述。还要成功调用：${missing.join('、')}。` }
  }
  const planLeft = input.planLeft ?? []
  if (planLeft.length > 0 && !ADMITS_FAILURE.test(input.answer)) {
    return { action: 'nudge', note: `计划还没做完。下一步：${planLeft[0]}。继续调用对应工具，不要在这里收尾。` }
  }
  return { action: 'accept' }
}

export function factIsGrounded(fact: string, sources: string[]): boolean {
  const needle = fact.replace(/\s+/g, '')
  if (needle.length < 2) return false
  return sources.some(source => source.replace(/\s+/g, '').includes(needle))
}
