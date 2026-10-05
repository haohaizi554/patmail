import { describe, expect, it } from 'vitest'
import { AGENT_CONFIG_DEFAULT } from '../src/agent/config'
import type { ChatOutcome } from '../src/agent/llm'
import { runAgentTurn, splitAgentReply, thoughtLead, type Complete } from '../src/agent/loop'
import { applySummary, COMPRESS_AT_CHARS, EMPTY_MEMORY, foldDigest, KEEP_RECENT_CHARS, needsCompression, rememberFact, searchFacts, splitForCompression, contextChars } from '../src/agent/memory'
import { executeAgentTool, type ToolContext } from '../src/agent/tools'
import { MessageType } from '../src/shared/message'

const config = { ...AGENT_CONFIG_DEFAULT, maxTokens: 64 }

function outcome(content: string, toolName?: string): ChatOutcome {
  return {
    usage: null,
    raw: {},
    choices: [{
      content,
      reasoning: '',
      finishReason: toolName ? 'tool_calls' : 'stop',
      toolCalls: toolName ? [{ id: 'call_1', type: 'function', function: { name: toolName, arguments: '{"text":"先看法律期限"}' } }] : []
    }]
  }
}

const idleContext: ToolContext = {
  forward: async () => ({ error: '尚未连接 EASY。' }),
  snapshot: () => ({ connected: false, displayName: '', origin: '', message: '尚未连接 EASY。' }),
  customers: async () => [],
  workflows: async () => [{ label: 'PCT提醒', summary: '把表格整理成信', steps: [{ title: '读表格', detail: '一行一件' }] }],
  skills: () => [{ title: '读表格', blurb: '从表格里读出文号', detail: '表头要对上。' }],
  lookupApi: query => `文档里没有对上「${query}」。`,
  createWorkflow: async () => '已创建工作流。',
  setWorkflowField: async () => '已改这一栏。',
  createTask: async () => '已记下任务。'
}

describe('agent memory', () => {
  it('compresses only after the stored cache crosses the size threshold', () => {
    const short = Array.from({ length: 40 }, (_, index) => ({ role: 'user' as const, content: `第${index}句` }))
    expect(needsCompression({ ...EMPTY_MEMORY, turns: short })).toBe(false)
    const turns = Array.from({ length: 60 }, (_, index) => ({ role: 'user' as const, content: `${index}:${'查'.repeat(4_000)}` }))
    const state = { ...EMPTY_MEMORY, turns }
    expect(contextChars(state)).toBeGreaterThan(COMPRESS_AT_CHARS)
    expect(needsCompression(state)).toBe(true)
    const next = applySummary(state, '用户在查期限')
    expect(next.summary).toBe('用户在查期限')
    expect(next.turns.length).toBeGreaterThan(8)
    expect(next.turns.length).toBeLessThan(turns.length)
    expect(contextChars({ ...next, summary: '' })).toBeLessThanOrEqual(KEEP_RECENT_CHARS)
    expect(next.turns.at(-1)?.content.startsWith('59:')).toBe(true)
  })

  it('keeps a tool call and its result on the same side of the cut', () => {
    const split = splitForCompression({
      ...EMPTY_MEMORY,
      turns: [
        { role: 'user', content: '旧'.repeat(100) },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c', type: 'function', function: { name: 'search_cases', arguments: '{}' } }] },
        { role: 'tool', content: 'P001', toolCallId: 'c' }
      ]
    }, 10)
    expect(split.older.map(turn => turn.role)).toEqual(['user'])
    expect(split.recent.map(turn => turn.role)).toEqual(['assistant', 'tool'])
    expect(split.recent[1]?.content).toBe('P001')
  })

  it('folds older turns into quoted lines and drops a free-form summary', () => {
    const folded = foldDigest('用户已经查到文号 P999 在甲公司名下。', [
      { role: 'user', content: '查文号 P001' },
      { role: 'tool', content: '没有查到 P001。' },
      { role: 'assistant', content: '\u001ethought\u001e先编一个客户\u001e没有查到。' }
    ])
    expect(folded).toContain('- 用户：查文号 P001')
    expect(folded).toContain('- 工具原文：没有查到 P001。')
    expect(folded).toContain('- 助手说过：没有查到。')
    expect(folded).not.toContain('P999')
    expect(folded).not.toContain('先编一个客户')
  })

  it('dedupes long-term facts and can search them', () => {
    const once = rememberFact(EMPTY_MEMORY, '先看法律期限')
    const twice = rememberFact(once, '先看法律期限')
    expect(twice.facts).toHaveLength(1)
    expect(searchFacts(twice, '法律').map(fact => fact.text)).toEqual(['先看法律期限'])
  })
})

describe('agent tools', () => {
  it('remembers through the tool and reports a missing connection', async () => {
    const remembered = await executeAgentTool('remember', '{"text":"先看法律期限"}', idleContext, EMPTY_MEMORY)
    expect(remembered.text).toContain('已记住')
    expect(remembered.memory.facts).toHaveLength(1)
    const status = await executeAgentTool('connection_status', '{}', idleContext, EMPTY_MEMORY)
    expect(status.text).toContain('尚未连接')
  })

  it('forwards a file search and summarizes the rows', async () => {
    let forwarded: unknown
    const ctx: ToolContext = {
      ...idleContext,
      forward: async message => {
        forwarded = message
        return {
          type: MessageType.SearchFilesResult,
          payload: {
            ok: true,
            data: {
              items: [{ fileId: 'f1', fileName: '受理通知书', caseVolume: 'P001', customerName: '甲公司' }],
              total: 1, pageIndex: 1, pageSize: 10, totalPages: 1
            }
          }
        }
      }
    }
    const result = await executeAgentTool('search_cases', '{"caseVolume":"P001"}', ctx, EMPTY_MEMORY)
    expect(forwarded).toMatchObject({ type: MessageType.SearchFiles, payload: { query: { caseVolume: 'P001', pageIndex: 1 } } })
    expect(result.text).toContain('P001')
    expect(result.text).toContain('共 1 条')
  })
})

describe('agent loop', () => {
  it('calls a tool and then answers from the tool result', async () => {
    const seen: string[] = []
    const activity: string[] = []
    const complete: Complete = async (_config, options) => {
      seen.push(options.messages.at(-1)?.role ?? '')
      if (!options.messages.some(message => message.role === 'tool')) return outcome('', 'remember')
      return outcome('已记下：以后先看法律期限。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '记住我先看法律期限', idleContext, complete, undefined, label => activity.push(label))
    expect(seen).toEqual(['user', 'tool'])
    expect(activity).toContain('正在记下')
    expect(turn.reply).toContain('法律期限')
    expect(turn.memory.facts.map(fact => fact.text)).toEqual(['先看法律期限'])
    expect(turn.history.map(item => item.role)).toEqual(['user', 'assistant'])
    expect(turn.steps).toBe(2)
  })

  it('puts the reasoning chain in front of the answer only when thinking is on', async () => {
    const complete: Complete = async () => ({
      usage: null,
      raw: {},
      choices: [{ content: '结论', reasoning: '先核对字段', finishReason: 'stop', toolCalls: [] }]
    })
    const on = await runAgentTurn({ ...config, thinking: true }, EMPTY_MEMORY, '你好', idleContext, complete)
    expect(splitAgentReply(on.reply)).toEqual({ thought: '先核对字段', answer: '结论' })
    const off = await runAgentTurn(config, EMPTY_MEMORY, '你好', idleContext, complete)
    expect(off.reply).toBe('结论')
  })

  it('folds a stored 思考 heading so the Chinese reply stays outside the chain', () => {
    const raw = '**思考**\n\nThe user said "你好" (Hello).\n\nI will respond in Chinese as requested.\n\n你好！我是 PatMail 执行助手。'
    expect(splitAgentReply(raw)).toEqual({
      thought: 'The user said "你好" (Hello).\n\nI will respond in Chinese as requested.',
      answer: '你好！我是 PatMail 执行助手。'
    })
    expect(thoughtLead(splitAgentReply(raw).thought)).toBe('The user said "你好" (Hello).')
  })

  it('keeps only the first line of a long thought as the collapsed lead', () => {
    expect(thoughtLead(`${'字'.repeat(40)}\n第二行不该露出来。`)).toBe(`${'字'.repeat(36)}…`)
  })
})
