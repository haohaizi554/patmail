import { describe, expect, it } from 'vitest'
import { AGENT_CONFIG_DEFAULT } from '../src/agent/config'
import type { ChatOutcome } from '../src/agent/llm'
import { LlmError } from '../src/agent/llm'
import { runAgentTurn, splitAgentReply, thoughtLead, type Complete } from '../src/agent/loop'
import { applySummary, clipToolResult, COMPRESS_AT_CHARS, EMPTY_MEMORY, foldDigest, KEEP_RECENT_CHARS, needsCompression, normalizeMemory, rememberFact, searchFacts, splitForCompression, contextChars, visibleHistory } from '../src/agent/memory'
import { emptyPageTools, executeAgentTool, formatDraft, type ToolContext } from '../src/agent/tools'
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
  createTask: async () => '已记下任务。',
  ...emptyPageTools()
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

  it('keeps the head and tail of a long tool result and hides gate notes', () => {
    const clipped = clipToolResult(`头${'中'.repeat(3_000)}尾标记`)
    expect(clipped.startsWith('头')).toBe(true)
    expect(clipped.endsWith('尾标记')).toBe(true)
    expect(clipped).toContain('中间已省略')
    const folded = foldDigest('', [
      { role: 'user', content: '去调用工具，不要只叙述。', hidden: true },
      { role: 'user', content: '查 P001' }
    ])
    expect(folded).toContain('查 P001')
    expect(folded).not.toContain('去调用工具')
    const memory = normalizeMemory({
      summary: '',
      turns: [{ role: 'user', content: '去调用工具', hidden: true }],
      facts: [],
      digestMisses: 2
    })
    expect(memory.turns[0]?.hidden).toBe(true)
    expect(memory.digestMisses).toBe(2)
    expect(visibleHistory(memory)).toEqual([])
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

  it('nudges a workflow claim until the tool succeeds, and hides the nudge', async () => {
    let phase = 0
    const complete: Complete = async () => {
      phase += 1
      if (phase === 1) return outcome('已经建好工作流了。')
      if (phase === 2) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'wf', type: 'function', function: { name: 'create_workflow', arguments: '{"name":"甲","skills":"读表格"}' } }]
          }]
        }
      }
      return outcome('已创建「甲」。可以在工作流页面看到。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '帮我建一个工作流，名字甲，本领读表格', idleContext, complete)
    expect(phase).toBe(3)
    expect(turn.reply).toContain('已创建')
    expect(turn.history.map(item => item.content).join('\n')).not.toContain('去调用工具')
  })

  it('warns on the third identical query and stops before the fifth run', async () => {
    let forwards = 0
    const ctx: ToolContext = {
      ...idleContext,
      forward: async () => {
        forwards += 1
        return { error: '尚未连接 EASY。' }
      }
    }
    const seen: string[] = []
    const complete: Complete = async (_config, options) => {
      seen.push(options.messages.filter(message => message.role === 'tool').map(message => message.content).join('\n'))
      if (!options.tools?.length) return outcome('停在文号 P001，不再重复查。')
      return {
        usage: null,
        raw: {},
        choices: [{
          content: '',
          reasoning: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: `c${seen.length}`, type: 'function', function: { name: 'search_cases', arguments: '{"caseVolume":"P001"}' } }]
        }]
      }
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '查文号 P001', ctx, complete)
    expect(forwards).toBe(4)
    expect(seen.some(text => text.includes('第 3 次'))).toBe(true)
    expect(seen.some(text => text.includes('重复了 5 次') && text.includes('search_cases'))).toBe(true)
    expect(turn.reply).toContain('P001')
  })

  it('asks again when a failed tool is described as done', async () => {
    let phase = 0
    const complete: Complete = async () => {
      phase += 1
      if (phase === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 's1', type: 'function', function: { name: 'search_cases', arguments: '{"caseVolume":"P001"}' } }]
          }]
        }
      }
      if (phase === 2) return outcome('已经办好了。')
      return outcome('还没连上，这一步没查成。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '查一下 P001', idleContext, complete)
    expect(turn.reply).toContain('没查成')
    expect(phase).toBe(3)
  })

  it('closes a maxed-out turn without tools, and keeps a blocked narration as the reply', async () => {
    const toolsOff: boolean[] = []
    const looping: Complete = async (_config, options) => {
      toolsOff.push(!options.tools?.length)
      if (!options.tools?.length) return outcome('查到一半，停在文件查询。')
      return {
        usage: null,
        raw: {},
        choices: [{
          content: '',
          reasoning: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: `t${toolsOff.length}`, type: 'function', function: { name: 'search_cases', arguments: JSON.stringify({ caseVolume: `P${toolsOff.length}` }) } }]
        }]
      }
    }
    const summarized = await runAgentTurn(config, EMPTY_MEMORY, '看一下连接', idleContext, looping)
    expect(summarized.reply).toContain('停在文件查询')
    expect(toolsOff.filter(Boolean)).toEqual([true])
    expect(toolsOff.filter(open => !open)).toHaveLength(6)

    let calls = 0
    const narrating: Complete = async (_config, options) => {
      calls += 1
      expect(options.tools?.length).toBeGreaterThan(0)
      return outcome('我已经建好了。')
    }
    const blocked = await runAgentTurn(config, EMPTY_MEMORY, '帮我建一个工作流', idleContext, narrating)
    expect(calls).toBe(3)
    expect(blocked.reply).toContain('建好')
  })

  it('hangs recall on the user message and drops a fact the user never said', async () => {
    let system = ''
    let user = ''
    const remembered = rememberFact({ ...EMPTY_MEMORY, summary: '摘录标记XYZ' }, '先看法律期限')
    const complete: Complete = async (_config, options) => {
      system = options.messages[0]?.content ?? ''
      user = options.messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
      return outcome('好。')
    }
    await runAgentTurn(config, remembered, '你好', idleContext, complete)
    expect(system).not.toContain('先看法律期限')
    expect(system).not.toContain('摘录标记XYZ')
    expect(user).toContain('先看法律期限')
    expect(user).toContain('摘录标记XYZ')

    let phase = 0
    const inventing: Complete = async () => {
      phase += 1
      if (phase === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'r1', type: 'function', function: { name: 'remember', arguments: '{"text":"凭空的客户甲"}' } }]
          }]
        }
      }
      return outcome('没有记下。')
    }
    const dropped = await runAgentTurn(config, EMPTY_MEMORY, '你好', idleContext, inventing)
    expect(dropped.memory.facts).toEqual([])
    expect(dropped.reply).toContain('没有记下')
  })

  it('retries a rate limit once, trims on overflow, and does not retry auth', async () => {
    let limited = 0
    const retry: Complete = async () => {
      limited += 1
      if (limited === 1) throw new LlmError('HTTP_ERROR', 'slow', 429)
      return outcome('好。')
    }
    const slowed = await runAgentTurn(config, EMPTY_MEMORY, '你好', idleContext, retry)
    expect(slowed.reply).toBe('好。')
    expect(limited).toBe(2)

    const long = `头${'中'.repeat(4_000)}尾端ZZ`
    let overflowed = 0
    const overflow: Complete = async (_config, options) => {
      overflowed += 1
      const tool = options.messages.find(message => message.role === 'tool')
      expect(tool?.content).toContain('中间已省略')
      expect(tool?.content.endsWith('尾端ZZ')).toBe(true)
      if (overflowed === 1) throw new LlmError('HTTP_ERROR', 'maximum context length exceeded', 400)
      return outcome('缩短后答完。')
    }
    const prior = {
      ...EMPTY_MEMORY,
      turns: [
        { role: 'user' as const, content: '查' },
        { role: 'assistant' as const, content: '', toolCalls: [{ id: 'old', type: 'function' as const, function: { name: 'search_cases', arguments: '{}' } }] },
        { role: 'tool' as const, content: long, toolCallId: 'old' }
      ]
    }
    const shortened = await runAgentTurn(config, prior, '继续', idleContext, overflow)
    expect(shortened.reply).toContain('缩短后')
    expect(overflowed).toBe(2)

    let authed = 0
    const denied: Complete = async () => {
      authed += 1
      throw new LlmError('HTTP_ERROR', 'no', 401)
    }
    await expect(runAgentTurn(config, EMPTY_MEMORY, '你好', idleContext, denied)).rejects.toBeInstanceOf(LlmError)
    expect(authed).toBe(1)
  })

  it('does not keep a remembered fact when the turn is stopped', async () => {
    const saved: Array<ReturnType<typeof rememberFact>> = []
    let phase = 0
    const complete: Complete = async () => {
      phase += 1
      if (phase === 1) return outcome('', 'remember')
      throw new LlmError('REQUEST_TIMEOUT', '已停下。')
    }
    await expect(runAgentTurn(config, EMPTY_MEMORY, '记住我先看法律期限', idleContext, complete, async state => {
      saved.push(state)
    })).rejects.toThrow('已停下。')
    expect(saved.at(-1)?.facts).toEqual([])
  })

  it('stops excerpting after three misses and still clips the tool text', async () => {
    const marker = `旧标记${'甲'.repeat(4_000)}`
    const turns = [
      { role: 'user' as const, content: marker },
      ...Array.from({ length: 50 }, (_, index) => ({ role: 'user' as const, content: `${index}:${'乙'.repeat(4_000)}` }))
    ]
    const complete: Complete = async () => outcome('还在。')
    const turn = await runAgentTurn(config, { ...EMPTY_MEMORY, turns, digestMisses: 3 }, '你好', idleContext, complete)
    expect(turn.memory.summary).toBe('')
    expect(turn.memory.turns.some(item => item.content.includes('旧标记'))).toBe(true)
  })

  it('keeps searched files on this turn and drafts from them', async () => {
    let volume = ''
    const ctx: ToolContext = {
      ...idleContext,
      rememberFiles(files) { volume = files[0]?.customerVolume ?? '' },
      recentFiles: () => [],
      draftMail: async () => formatDraft({
        letters: 1,
        subject: 'ZL20250306002-受理',
        body: '您好',
        notes: ['模板里的 {未知栏} 还没有对应内容'],
        who: '收件：未定'
      }),
      forward: async () => ({
        type: MessageType.SearchFilesResult,
        payload: {
          ok: true,
          data: {
            items: [{ fileId: 'f1', fileName: '受理通知书', customerName: '甲公司', customerVolume: 'ZL20250306002' }],
            total: 1, pageIndex: 1, pageSize: 10, totalPages: 1
          }
        }
      })
    }
    const searched = await executeAgentTool('search_cases', '{"customerName":"甲公司"}', ctx, EMPTY_MEMORY)
    expect(searched.text).toContain('文件查询共 1 条')
    expect(volume).toBe('ZL20250306002')
    let phase = 0
    const seen: string[] = []
    const complete: Complete = async (_config, options) => {
      phase += 1
      seen.push(options.messages.filter(message => message.role === 'tool').map(message => message.content).join('\n'))
      if (phase === 1) return outcome('信已经对好了。')
      if (phase === 2) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'd1', type: 'function', function: { name: 'draft_mail', arguments: '{"customerName":"甲公司"}' } }]
          }]
        }
      }
      return outcome('主题已经起草，还有没收录的占位符。没有提交。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '帮我对上要发的信', ctx, complete)
    expect(phase).toBe(3)
    expect(seen.some(text => text.includes('主题：ZL20250306002-受理') && text.includes('{未知栏}'))).toBe(true)
    expect(turn.reply).toContain('没有提交')
  })

  it('submits only after submit_easy succeeds, and still finishes the turn', async () => {
    let phase = 0
    const ctx: ToolContext = {
      ...idleContext,
      submitEasy: async () => '已提交到 EASY。已提交 1 件给当前登录人审核。'
    }
    const complete: Complete = async () => {
      phase += 1
      if (phase === 1) return outcome('已提交审核。')
      if (phase === 2) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 's1', type: 'function', function: { name: 'submit_easy', arguments: '{"caseVolume":"P001"}' } }]
          }]
        }
      }
      return outcome('已提交到 EASY，交给当前登录人审核。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '帮我提交审核', ctx, complete)
    expect(phase).toBe(3)
    expect(turn.reply).toContain('已提交到 EASY')
  })
})
