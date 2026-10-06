import { describe, expect, it } from 'vitest'
import { AGENT_CONFIG_DEFAULT } from '../src/agent/config'
import type { ChatOutcome } from '../src/agent/llm'
import { compactAgentMemory, runAgentTurn, type Complete } from '../src/agent/loop'
import { EMPTY_MEMORY } from '../src/agent/memory'
import { filterCommands, resolveSlash, SLASH_COMMANDS, slashToken } from '../src/agent/slash'
import { emptyPageTools, type ToolContext } from '../src/agent/tools'

const config = { ...AGENT_CONFIG_DEFAULT, maxTokens: 64 }

function outcome(content: string): ChatOutcome {
  return { usage: null, raw: {}, choices: [{ content, reasoning: '', finishReason: 'stop', toolCalls: [] }] }
}

const idleContext: ToolContext = {
  forward: async () => ({ error: '尚未连接 EASY。' }),
  snapshot: () => ({ connected: false, displayName: '', origin: '', message: '尚未连接 EASY。' }),
  customers: async () => [],
  workflows: async () => [],
  skills: () => [],
  lookupApi: query => `文档里没有对上「${query}」。`,
  createWorkflow: async () => '已创建工作流。',
  setWorkflowField: async () => '已改这一栏。',
  createTask: async () => '已记下任务。',
  ...emptyPageTools()
}

describe('slash commands', () => {
  it('filters the menu by the token after /', () => {
    expect(slashToken('/查')).toBe('查')
    expect(slashToken('/查案件 P001')).toBeNull()
    expect(filterCommands('查').map(command => command.name)).toEqual(['查案件', '查期限'])
    expect(filterCommands('help').map(command => command.name)).toEqual(['帮助'])
    expect(filterCommands('读').map(command => command.name)).toEqual(['读表格'])
    expect(filterCommands('表格').map(command => command.name)).toEqual(['读表格'])
    for (const command of SLASH_COMMANDS) expect(command.description.length).toBeLessThanOrEqual(60)
  })

  it('keeps local commands and incomplete skills away from the model', () => {
    expect(resolveSlash('你好')).toEqual({ kind: 'text' })
    expect(resolveSlash('/help').kind).toBe('local')
    expect(resolveSlash('/记住')).toMatchObject({ kind: 'need-args', name: '记住' })
    expect(resolveSlash('/没有这个')).toMatchObject({ kind: 'unknown' })
    const skill = resolveSlash('/查案件 P001')
    expect(skill).toMatchObject({ kind: 'skill', name: '查案件', display: '/查案件 P001' })
    if (skill.kind === 'skill') {
      expect(skill.guidance).toContain('search_cases')
      expect(skill.guidance).toContain('P001')
    }
    const letter = resolveSlash('/对上要发的信')
    if (letter.kind === 'skill') expect(letter.guidance).toContain('draft_mail')
  })
})

describe('slash turns', () => {
  it('shows the short command and gives the model the skill guidance', async () => {
    let seen = ''
    const complete: Complete = async (_config, options) => {
      seen = options.messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
      return outcome('还没连上 EASY。')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '/查案件 P001', idleContext, complete)
    expect(turn.history[0]?.content).toBe('/查案件 P001')
    expect(turn.history[0]?.content).not.toContain('search_cases')
    expect(seen).toContain('search_cases')
    expect(seen).toContain('P001')
    expect(turn.memory.turns[0]?.guidance).toContain('search_cases')
  })

  it('does not call the model for an unknown command', async () => {
    let called = false
    const complete: Complete = async () => {
      called = true
      return outcome('不该出现')
    }
    const turn = await runAgentTurn(config, EMPTY_MEMORY, '/没有这个', idleContext, complete)
    expect(called).toBe(false)
    expect(turn.memory.turns).toHaveLength(0)
    expect(turn.reply).toContain('没有')
  })

  it('compacts only the overflow and keeps the large recent tail', async () => {
    const turns = [
      { role: 'user' as const, content: `旧${'甲'.repeat(80_000)}` },
      { role: 'user' as const, content: `新${'乙'.repeat(80_000)}` }
    ]
    const compacted = await compactAgentMemory(config, { ...EMPTY_MEMORY, turns }, async () => outcome('用户在逐句试对话'))
    expect(compacted.reply).toContain('原文摘录')
    expect(compacted.memory.summary).toContain('- 用户：旧')
    expect(compacted.memory.summary).not.toContain('逐句')
    expect(compacted.memory.turns).toHaveLength(1)
    expect(compacted.memory.turns[0]?.content.startsWith('新')).toBe(true)
    const short = await compactAgentMemory(config, EMPTY_MEMORY, async () => outcome('不该调用'))
    expect(short.reply).toContain('还没到')
  })
})
