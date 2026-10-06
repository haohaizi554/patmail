import { describe, expect, it } from 'vitest'
import { AGENT_CONFIG_DEFAULT } from '../src/agent/config'
import type { ChatOutcome } from '../src/agent/llm'
import { LlmError } from '../src/agent/llm'
import { runAgentTurn, splitAgentReply, thoughtLead, type Complete } from '../src/agent/loop'
import { applySummary, clipToolResult, COMPRESS_AT_CHARS, EMPTY_MEMORY, foldDigest, KEEP_RECENT_CHARS, needsCompression, normalizeMemory, projectOldToolText, rememberFact, searchFacts, splitForCompression, contextChars, visibleHistory } from '../src/agent/memory'
import { agentToolSchemas, emptyPageTools, executeAgentTool, formatDraft, type ToolContext } from '../src/agent/tools'
import { groupToolCalls } from '../src/agent/turn-policy'
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
  it('keeps older tool text in storage and sends only the first line', async () => {
    const stored = '文件查询共 1 条。\n案件编号 CASE-1\n受理通知书'
    expect(projectOldToolText(stored)).toContain('已收成一行')
    expect(projectOldToolText(stored)).not.toContain('CASE-1')
    expect(projectOldToolText('文件查询共 1 条。')).toBe('文件查询共 1 条。')
    const prior = {
      ...EMPTY_MEMORY,
      turns: [
        { role: 'user' as const, content: '查一下' },
        { role: 'tool' as const, content: stored, toolCallId: 'old' },
        { role: 'assistant' as const, content: '查到了。' }
      ]
    }
    let toolText = ''
    const complete: Complete = async (_config, options) => {
      toolText = options.messages.find(message => message.role === 'tool')?.content ?? ''
      return outcome('这一轮还没查。')
    }
    const turn = await runAgentTurn(config, prior, '再看一眼', idleContext, complete)
    expect(toolText).not.toContain('CASE-1')
    expect(toolText).toContain('已收成一行')
    expect(turn.memory.turns.find(item => item.toolCallId === 'old')?.content).toContain('CASE-1')
  })

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

  it('asks once more for the conclusion when thinking is cut off by the length limit', async () => {
    const thinking: boolean[] = []
    const complete: Complete = async (active, options) => {
      thinking.push(active.thinking)
      if (thinking.length === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '让我看看规则。我应该如实反馈。让我再试一次。规则说不能编。',
            finishReason: 'length',
            toolCalls: []
          }]
        }
      }
      expect(options.messages.at(-1)?.content).toContain('直接给出结论')
      expect(options.tools).toBeUndefined()
      return { usage: null, raw: {}, choices: [{ content: '文档里没有登录方面的接口。', reasoning: '', finishReason: 'stop', toolCalls: [] }] }
    }
    const turn = await runAgentTurn({ ...config, thinking: true, maxTokens: 1024 }, EMPTY_MEMORY, '登录方面的接口有哪些', idleContext, complete)
    expect(thinking).toEqual([true, false])
    expect(splitAgentReply(turn.reply).answer).toBe('文档里没有登录方面的接口。')
    expect(turn.reply).not.toContain('让我看看规则')
  })

  it('stitches a reply that stopped at the length limit', async () => {
    let calls = 0
    const complete: Complete = async () => {
      calls += 1
      if (calls === 1) return { usage: null, raw: {}, choices: [{ content: '查到 2 件。', reasoning: '', finishReason: 'length', toolCalls: [] }] }
      return { usage: null, raw: {}, choices: [{ content: '都还没到提交。', reasoning: '', finishReason: 'stop', toolCalls: [] }] }
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '查一下', idleContext, complete)
    expect(turn.reply).toBe('查到 2 件。\n都还没到提交。')
  })

  it('shows the draft while the model is still writing, even when thinking is off', async () => {
    const seen: string[] = []
    const complete: Complete = async (_active, options) => {
      options.onDelta?.({ reasoning: '', content: '让我再看规则' })
      options.onDelta?.({ reasoning: '', content: '让我再看规则。没有对上。' })
      return { usage: null, raw: {}, choices: [{ content: '没有对上。', reasoning: '', finishReason: 'stop', toolCalls: [] }] }
    }
    const labels: string[] = []
    await runAgentTurn(config, EMPTY_MEMORY, '登录接口', idleContext, complete, undefined, (label, thought) => {
      labels.push(label)
      if (thought) seen.push(thought)
    })
    expect(labels).toContain('正在写')
    expect(seen.some(item => item.includes('让我再看规则'))).toBe(true)
  })

  it('hides an unclosed think tag instead of showing it as the answer', () => {
    const split = splitAgentReply('<think>先看规则\n还在想')
    expect(split.answer).toBe('')
    expect(split.thought).toContain('先看规则')
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
        return {
          type: MessageType.SearchFilesResult,
          payload: {
            ok: true,
            data: {
              items: [{ fileId: 'f1', fileName: '受理通知书', caseVolume: 'P001' }],
              total: 1, pageIndex: 1, pageSize: 10, totalPages: 1
            }
          }
        }
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

  it('retries a gateway 502 twice, then surfaces the error', async () => {
    let calls = 0
    const activity: string[] = []
    const complete: Complete = async () => {
      calls += 1
      if (calls < 3) throw new LlmError('HTTP_ERROR', '模型服务返回 HTTP 502。', 502)
      return outcome('接上了。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '你好', idleContext, complete, undefined, label => activity.push(label))
    expect(turn.reply).toBe('接上了。')
    expect(calls).toBe(3)
    expect(activity.filter(item => item === '模型暂时没接上，再试一次')).toHaveLength(2)

    let failed = 0
    const down: Complete = async () => {
      failed += 1
      throw new LlmError('HTTP_ERROR', '模型服务返回 HTTP 502。', 502)
    }
    await expect(runAgentTurn(config, EMPTY_MEMORY, '你好', idleContext, down)).rejects.toThrow('502')
    expect(failed).toBe(3)
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
            items: [{ fileId: 'f1', fileName: '受理通知书', customerName: '甲公司', customerVolume: 'ZL20250306002', caseId: 'CASE-1' }],
            total: 1, pageIndex: 1, pageSize: 10, totalPages: 1
          }
        }
      })
    }
    const searched = await executeAgentTool('search_cases', '{"customerName":"甲公司"}', ctx, EMPTY_MEMORY)
    expect(searched.text).toContain('文件查询共 1 条')
    expect(searched.text).toContain('案件编号 CASE-1')
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

describe('tool waves and schemas', () => {
  it('runs case, deadline and api lookups together, and keeps writes alone', () => {
    expect(groupToolCalls(['search_cases', 'search_deadlines', 'lookup_api', 'draft_mail'])).toEqual([[0, 1, 2], [3]])
    expect(groupToolCalls(['search_cases', 'search_cases'])).toEqual([[0], [1]])
    expect(groupToolCalls(['submit_easy', 'lookup_api'])).toEqual([[0], [1]])
  })

  it('leaves reviewer and mail-check schemas out until the question needs them', () => {
    const plain = agentToolSchemas(['查一下文号 P001']).map(tool => tool.function.name)
    expect(plain).toContain('search_cases')
    expect(plain).toContain('call_easy')
    expect(plain).toContain('ask_user')
    expect(plain).toContain('plan_work')
    expect(plain).not.toContain('list_reviewers')
    expect(plain).not.toContain('diagnose_mail')
    expect(agentToolSchemas(['审核人有哪些']).map(tool => tool.function.name)).toContain('list_reviewers')
  })

  it('overlaps readonly lookups in one model step', async () => {
    let inflight = 0
    let peak = 0
    const ctx: ToolContext = {
      ...idleContext,
      customers: async () => {
        inflight += 1
        peak = Math.max(peak, inflight)
        await new Promise(resolve => setTimeout(resolve, 40))
        inflight -= 1
        return []
      },
      lookupApi: () => {
        inflight += 1
        peak = Math.max(peak, inflight)
        inflight -= 1
        return '文档里没有对上「登录」。'
      }
    }
    let step = 0
    const complete: Complete = async () => {
      step += 1
      if (step === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'list_customers', arguments: '{}' } },
              { id: 'c2', type: 'function', function: { name: 'lookup_api', arguments: '{"query":"登录"}' } }
            ]
          }]
        }
      }
      return outcome('两边都看过了。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '客户和登录接口一起看', ctx, complete)
    expect(peak).toBe(2)
    expect(turn.reply).toContain('两边都看过了')
  })

  it('stops a query after two failures with the same arguments', async () => {
    let sent = 0
    const ctx: ToolContext = {
      ...idleContext,
      forward: async () => {
        sent += 1
        return { error: '尚未连接 EASY。' }
      }
    }
    let phase = 0
    const complete: Complete = async () => {
      phase += 1
      if (phase < 4) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: `s${phase}`, type: 'function', function: { name: 'search_cases', arguments: '{"caseVolume":"P001"}' } }]
          }]
        }
      }
      return outcome('连着没连上，先停在查案件。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '查一下 P001', ctx, complete)
    expect(sent).toBe(2)
    expect(turn.memory.turns.some(item => item.content.includes('连着失败'))).toBe(true)
  })

  it('retries a dropped connection once', async () => {
    let calls = 0
    const seen: string[] = []
    const complete: Complete = async () => {
      calls += 1
      if (calls === 1) throw new LlmError('NETWORK_ERROR', '无法连接模型服务，请检查地址、密钥和网络。')
      return outcome('接上了。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '查一下', idleContext, complete, undefined, label => { seen.push(label) })
    expect(calls).toBe(2)
    expect(seen).toContain('网络不稳，再试一次')
    expect(turn.reply).toBe('接上了。')
  })

  it('continues after the model asks and the user answers', async () => {
    let phase = 0
    const ctx: ToolContext = { ...idleContext, askUser: async () => '1. 工作流叫什么\nPCT提醒' }
    const complete: Complete = async (_config, options) => {
      phase += 1
      if (phase === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{
            content: '',
            reasoning: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'a1', type: 'function', function: { name: 'ask_user', arguments: '{"questions":[{"prompt":"工作流叫什么"}]}' } }]
          }]
        }
      }
      const tool = options.messages.filter(message => message.role === 'tool').at(-1)?.content ?? ''
      expect(tool.startsWith('用户答：')).toBe(true)
      expect(tool).toContain('PCT提醒')
      return outcome('名字用 PCT提醒。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '先问我工作流的名字', ctx, complete)
    expect(phase).toBe(2)
    expect(turn.reply).toContain('PCT提醒')
  })

  it('stops the turn when the user stops during a question', async () => {
    const ctx: ToolContext = { ...idleContext, askUser: async () => '已停下。' }
    const complete: Complete = async () => ({
      usage: null,
      raw: {},
      choices: [{
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'a1', type: 'function', function: { name: 'ask_user', arguments: '{"questions":[{"prompt":"叫什么"}]}' } }]
      }]
    })
    await expect(runAgentTurn(config, EMPTY_MEMORY, '建一条工作流', ctx, complete)).rejects.toMatchObject({ message: '已停下。' })
  })

  it('follows a written plan past the short step cap', async () => {
    const sequence = ['list_customers', 'list_skills', 'describe_workflows', 'lookup_api', 'recall', 'list_tasks']
    const planArgs = JSON.stringify({
      steps: [
        { title: '看客户', tool: 'list_customers' },
        { title: '看本领', tool: 'list_skills' },
        { title: '看工作流', tool: 'describe_workflows' },
        { title: '查接口', tool: 'lookup_api' },
        { title: '翻记忆', tool: 'recall' },
        { title: '列任务', tool: 'list_tasks' }
      ]
    })
    let phase = 0
    const labels: string[] = []
    const complete: Complete = async () => {
      phase += 1
      if (phase === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{ content: '', reasoning: '', finishReason: 'tool_calls', toolCalls: [{ id: 'p', type: 'function', function: { name: 'plan_work', arguments: planArgs } }] }]
        }
      }
      const tool = sequence[phase - 2]
      if (tool) {
        const args = tool === 'lookup_api' ? '{"query":"登录"}' : tool === 'recall' ? '{"query":"客户"}' : '{}'
        return {
          usage: null,
          raw: {},
          choices: [{ content: '', reasoning: '', finishReason: 'tool_calls', toolCalls: [{ id: `t${phase}`, type: 'function', function: { name: tool, arguments: args } }] }]
        }
      }
      return outcome('六步都办好了。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '这几件一起办', idleContext, complete, undefined, label => { labels.push(label) })
    expect(phase).toBe(8)
    expect(turn.reply).toBe('六步都办好了。')
    expect(labels).toContain('已拆成计划')
  })

  it('keeps going when the model tries to finish with a step left', async () => {
    const planArgs = JSON.stringify({
      steps: [
        { title: '看客户', tool: 'list_customers' },
        { title: '看本领', tool: 'list_skills' }
      ]
    })
    let phase = 0
    const complete: Complete = async () => {
      phase += 1
      if (phase === 1) {
        return {
          usage: null,
          raw: {},
          choices: [{ content: '', reasoning: '', finishReason: 'tool_calls', toolCalls: [{ id: 'p', type: 'function', function: { name: 'plan_work', arguments: planArgs } }] }]
        }
      }
      if (phase === 2 || phase === 4) {
        const tool = phase === 2 ? 'list_customers' : 'list_skills'
        return {
          usage: null,
          raw: {},
          choices: [{ content: '', reasoning: '', finishReason: 'tool_calls', toolCalls: [{ id: tool, type: 'function', function: { name: tool, arguments: '{}' } }] }]
        }
      }
      if (phase === 3) return outcome('已经办好了。')
      return outcome('两步都办好了。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '先看客户再看本领', idleContext, complete)
    expect(phase).toBe(5)
    expect(turn.reply).toBe('两步都办好了。')
  })
})
