/** 助手决定要问的一题。选项和是否还要手写，都由这一次调用给出。 */
export interface AgentQuestion {
  id: string
  prompt: string
  placeholder: string
  choices: string[]
  multiple: boolean
  needsText: boolean
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function isAgentQuestion(value: unknown): value is AgentQuestion {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.prompt === 'string' && row.prompt.trim().length > 0 &&
    typeof row.placeholder === 'string' &&
    Array.isArray(row.choices) && row.choices.every(item => typeof item === 'string') &&
    typeof row.multiple === 'boolean' && typeof row.needsText === 'boolean'
}

/** 从工具参数里读出一到三个问题。写不清就不问。 */
export function readAgentQuestions(args: Record<string, unknown>): AgentQuestion[] | null {
  const raw = args.questions
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) return null
  const questions: AgentQuestion[] = []
  for (const [index, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    const prompt = text(row.prompt, 80)
    if (!prompt) return null
    const choices = Array.isArray(row.choices)
      ? row.choices.map(choice => text(choice, 24)).filter(Boolean).slice(0, 8)
      : []
    questions.push({
      id: `q${index + 1}`,
      prompt,
      placeholder: text(row.placeholder, 40),
      choices,
      multiple: row.multiple === true,
      needsText: row.needsText === true
    })
  }
  return questions
}

export function formatAgentAnswer(questions: readonly AgentQuestion[], answers: Record<string, string>): string {
  return questions.map((question, index) => `${index + 1}. ${question.prompt}\n${(answers[question.id] ?? '').trim()}`).join('\n')
}
