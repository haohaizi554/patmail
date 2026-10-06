import { describe, expect, it } from 'vitest'
import { formatAgentAnswer, isAgentQuestion, readAgentQuestions } from '../src/agent/ask'
import { EMPTY_MEMORY } from '../src/agent/memory'
import { emptyPageTools, executeAgentTool, type ToolContext } from '../src/agent/tools'

const idle: ToolContext = {
  forward: async () => ({ error: '尚未连接 EASY。' }),
  snapshot: () => ({ connected: false, displayName: '', origin: '', message: '尚未连接 EASY。' }),
  customers: async () => [],
  workflows: async () => [],
  skills: () => [],
  lookupApi: () => '',
  createWorkflow: async () => '',
  setWorkflowField: async () => '',
  createTask: async () => '',
  ...emptyPageTools()
}

describe('agent questions', () => {
  it('reads one to three questions and drops a vague call', () => {
    const questions = readAgentQuestions({
      questions: [
        { prompt: '工作流叫什么', placeholder: '例如 PCT提醒', needsText: true },
        { prompt: '包含哪些步骤', choices: ['读表格', '核对事项'], multiple: true }
      ]
    })
    expect(questions).toHaveLength(2)
    expect(questions?.[0]).toMatchObject({ id: 'q1', needsText: true, choices: [] })
    expect(questions?.[1]).toMatchObject({ id: 'q2', multiple: true, choices: ['读表格', '核对事项'] })
    expect(isAgentQuestion(questions?.[0])).toBe(true)
    expect(readAgentQuestions({})).toBeNull()
    expect(readAgentQuestions({ questions: [{ prompt: '' }] })).toBeNull()
    expect(readAgentQuestions({ questions: [{}, {}, {}, {}] })).toBeNull()
  })

  it('formats the card answers and treats skip as unfinished', async () => {
    const questions = readAgentQuestions({ questions: [{ prompt: '工作流叫什么' }] })
    expect(questions).not.toBeNull()
    if (!questions) return
    expect(formatAgentAnswer(questions, { q1: 'PCT提醒' })).toBe('1. 工作流叫什么\nPCT提醒')
    const answered = await executeAgentTool('ask_user', '{"questions":[{"prompt":"工作流叫什么"}]}', {
      ...idle,
      askUser: async () => '1. 工作流叫什么\nPCT提醒'
    }, EMPTY_MEMORY)
    expect(answered.text.startsWith('用户答：')).toBe(true)
    const skipped = await executeAgentTool('ask_user', '{"questions":[{"prompt":"工作流叫什么"}]}', {
      ...idle,
      askUser: async () => '跳过'
    }, EMPTY_MEMORY)
    expect(skipped.text).toBe('用户跳过了这个问题。')
    const alone = await executeAgentTool('ask_user', '{"questions":[{"prompt":"工作流叫什么"}]}', idle, EMPTY_MEMORY)
    expect(alone.text).toBe('现在没有人可以回答。')
  })
})
