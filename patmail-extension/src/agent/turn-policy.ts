/** 6 步办事循环用的收尾和空转规则。阈值按三家助手缩小，不照搬它们的默认值。 */

export const MAX_STEPS = 6
export const MAX_NUDGES = 2
export const STALL_WARN_AT = 3
export const STALL_STOP_AT = 5
export const UNKNOWN_STOP_AT = 3
export const DIGEST_MISS_LIMIT = 3
export const RATE_LIMIT_BACKOFF_MS = 1_000

export const STEP_LIMIT_REPLY = '这轮工具调用已经到上限，先停在这里。可以把要求再说具体一点，或让我只查其中一件。'
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

export function requiredTools(userText: string): string[] {
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

export function toolSucceeded(name: string, text: string): boolean {
  if (/^(没有这个工具|工具参数不是有效 JSON|工具没有完成)/.test(text)) return false
  if (name === 'connection_status') return text.startsWith('已连接')
  if (name === 'search_cases') return text.startsWith('文件查询共')
  if (name === 'search_deadlines') return text.startsWith('期限监控共')
  if (name === 'list_customers' || name === 'list_skills' || name === 'recall') return true
  if (name === 'lookup_api') return !text.startsWith('请给出')
  if (name === 'describe_workflows') return !text.startsWith('没有对上的工作流')
  if (name === 'remember') return text.startsWith('已记住') || text.startsWith('这句话已经在长期记忆')
  if (name === 'create_workflow' || name === 'set_workflow_field') return text.startsWith('已')
  if (name === 'create_task') return text.includes('没有提交到 EASY')
  if (name === 'read_customer') return text.startsWith('客户 ')
  if (name === 'preview_workflow') return text.startsWith('工作流预览')
  if (name === 'draft_mail') return text.startsWith('起草完成')
  if (name === 'list_tasks') return text.startsWith('发文任务共')
  if (name === 'list_history') return text.startsWith('查询记录共')
  if (name === 'list_reviewers') return text.startsWith('审核人共')
  if (name === 'list_processes') return text.startsWith('流程共')
  if (name === 'list_acceptance') return text.startsWith('验收共')
  if (name === 'readonly_acceptance') return text.startsWith('只读验收 ')
  if (name === 'diagnose_mail') return text.startsWith('邮件核对 ')
  if (name === 'export_contacts') return text.startsWith('联系人共')
  if (name === 'submit_easy') return text.startsWith('已提交到 EASY')
  return false
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

const ADMITS_FAILURE = /没|无法|失败|尚未|不能|未完成/
const CLAIMS_SUBMIT = /已提交审核|已经提交审核|已代点|已经代点|已创建发文/

export function reviewReply(input: { answer: string; required: string[]; traces: ToolTrace[]; submitAsked: boolean }): { action: 'accept' } | { action: 'nudge'; note: string } {
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
  return { action: 'accept' }
}

export function factIsGrounded(fact: string, sources: string[]): boolean {
  const needle = fact.replace(/\s+/g, '')
  if (!needle) return false
  return sources.some(source => source.replace(/\s+/g, '').includes(needle))
}
