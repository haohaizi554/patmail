import type { AgentConfig } from './config'

/** OpenAI 兼容的对话消息。tool 相关字段供后续 agent 循环使用，本次接入先走纯文本。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: AssistantToolCall[]
}

export interface AssistantToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolSchema {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatChoice {
  content: string
  /** 思考链。只有设置里打开思考模式时才展示。 */
  reasoning: string
  finishReason: string
  toolCalls: AssistantToolCall[]
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
}

export interface ChatOutcome {
  choices: ChatChoice[]
  usage: ChatUsage | null
  raw: unknown
}

export class LlmError extends Error {
  readonly code: 'NETWORK_ERROR' | 'REQUEST_TIMEOUT' | 'HTTP_ERROR' | 'INVALID_RESPONSE'
  readonly status?: number

  constructor(code: LlmError['code'], message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface ChatDelta {
  reasoning: string
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  tools?: ToolSchema[]
  temperature?: number
  timeoutMs?: number
  fetcher?: typeof fetch
  signal?: AbortSignal
  /** 有这个回调时走流式响应，思考链会边生成边送回来。 */
  onDelta?: (partial: ChatDelta) => void
}

function endpointOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return `${trimmed}/chat/completions`
}

function requestHeaders(config: AgentConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    // 该端点用 x-api-key 鉴权；同时带 Bearer，兼容标准 OpenAI 网关。
    'x-api-key': config.apiKey,
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'text/event-stream, application/json'
  }
}

interface ToolDraft { id: string; name: string; arguments: string }

function draftsToCalls(tools: ToolDraft[]): AssistantToolCall[] {
  return tools.filter(tool => tool.id && tool.name).map(tool => ({
    id: tool.id,
    type: 'function' as const,
    function: { name: tool.name, arguments: tool.arguments }
  }))
}

function absorbToolDelta(tools: ToolDraft[], raw: unknown): void {
  if (!Array.isArray(raw)) return
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const index = typeof record.index === 'number' ? record.index : tools.length
    const current = tools[index] ?? { id: '', name: '', arguments: '' }
    if (typeof record.id === 'string' && record.id) current.id = record.id
    const fn = record.function
    if (typeof fn === 'object' && fn !== null) {
      const call = fn as Record<string, unknown>
      if (typeof call.name === 'string') current.name += call.name
      if (typeof call.arguments === 'string') current.arguments += call.arguments
    }
    tools[index] = current
  }
}

function choiceFromPayload(parsed: unknown): ChatChoice {
  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    throw new LlmError('INVALID_RESPONSE', '模型服务响应里没有 choices。')
  }
  const first = record.choices[0]
  const choice = (typeof first === 'object' && first !== null ? first : {}) as Record<string, unknown>
  const message = (typeof choice.message === 'object' && choice.message !== null ? choice.message : {}) as Record<string, unknown>
  return {
    content: typeof message.content === 'string' ? message.content : '',
    reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : '',
    toolCalls: parseToolCalls(message.tool_calls)
  }
}

/** 读 OpenAI 兼容的 SSE。服务端如果仍回整段 JSON，也按整段解析。 */
async function readChatStream(response: Response, onDelta: (partial: ChatDelta) => void): Promise<ChatChoice> {
  const reader = response.body?.getReader()
  if (!reader) return choiceFromPayload(JSON.parse(await response.text()))
  const decoder = new TextDecoder()
  let buffer = ''
  let sawEvent = false
  const choice: ChatChoice = { content: '', reasoning: '', finishReason: '', toolCalls: [] }
  const tools: ToolDraft[] = []
  const emit = (): void => onDelta({ reasoning: choice.reasoning, content: choice.content })
  const applyEvent = (data: string): void => {
    if (!data || data === '[DONE]') return
    const parsed = JSON.parse(data) as Record<string, unknown>
    const first = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined
    const row = (typeof first === 'object' && first !== null ? first : {}) as Record<string, unknown>
    const delta = (typeof row.delta === 'object' && row.delta !== null ? row.delta : {}) as Record<string, unknown>
    if (typeof delta.reasoning_content === 'string') choice.reasoning += delta.reasoning_content
    else if (typeof delta.reasoning === 'string') choice.reasoning += delta.reasoning
    if (typeof delta.content === 'string') choice.content += delta.content
    if (typeof row.finish_reason === 'string' && row.finish_reason) choice.finishReason = row.finish_reason
    absorbToolDelta(tools, delta.tool_calls)
    emit()
  }
  const takeLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    sawEvent = true
    applyEvent(trimmed.slice(5).trim())
  }
  while (true) {
    const step = await reader.read()
    if (step.done) break
    buffer += decoder.decode(step.value, { stream: true })
    if (!sawEvent && buffer.trimStart().startsWith('{')) {
      while (true) {
        const rest = await reader.read()
        if (rest.done) break
        buffer += decoder.decode(rest.value, { stream: true })
      }
      const whole = choiceFromPayload(JSON.parse(buffer))
      onDelta({ reasoning: whole.reasoning, content: whole.content })
      return whole
    }
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) takeLine(line)
  }
  if (buffer.trim()) takeLine(buffer)
  if (!sawEvent && buffer.trim().startsWith('{')) {
    const whole = choiceFromPayload(JSON.parse(buffer))
    onDelta({ reasoning: whole.reasoning, content: whole.content })
    return whole
  }
  choice.toolCalls = draftsToCalls(tools)
  return choice
}

function parseToolCalls(raw: unknown): AssistantToolCall[] {
  if (!Array.isArray(raw)) return []
  const calls: AssistantToolCall[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const functionPart = record.function
    if (typeof record.id !== 'string' || typeof functionPart !== 'object' || functionPart === null) continue
    const fn = functionPart as Record<string, unknown>
    if (typeof fn.name !== 'string' || typeof fn.arguments !== 'string') continue
    calls.push({ id: record.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } })
  }
  return calls
}

/** 单次（非流式）chat/completions 调用。地址与密钥只来自后台读取的配置。 */
export async function chatCompletion(config: AgentConfig, options: ChatOptions): Promise<ChatOutcome> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const controller = new AbortController()
  let timedOut = false
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? 120_000)
  try {
    const response = await fetcher(endpointOf(config.baseUrl), {
      method: 'POST',
      headers: requestHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages: options.messages.map(message => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
          ...(message.toolCalls === undefined || message.toolCalls.length === 0 ? {} : {
            tool_calls: message.toolCalls.map(call => ({ id: call.id, type: call.type, function: call.function }))
          })
        })),
        ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: options.tools }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(config.maxTokens > 0 ? { max_tokens: config.maxTokens } : {}),
        // Qwen3 系用这个字段开关思考链。关掉时必须显式传 false，只省略字段时服务端仍可能在想。
        chat_template_kwargs: { enable_thinking: config.thinking },
        ...(options.onDelta ? { stream: true } : {})
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const brief = body.slice(0, 300).replace(/\s+/g, ' ').trim()
      throw new LlmError('HTTP_ERROR', `模型服务返回 HTTP ${response.status}${brief ? `：${brief}` : '。'}`, response.status)
    }
    if (options.onDelta && response.body) {
      const choice = await readChatStream(response, options.onDelta)
      return { choices: [choice], usage: null, raw: null }
    }
    const body = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new LlmError('INVALID_RESPONSE', '模型服务响应不是有效 JSON。')
    }
    const record = parsed as Record<string, unknown>
    if (!Array.isArray(record.choices) || record.choices.length === 0) {
      throw new LlmError('INVALID_RESPONSE', '模型服务响应里没有 choices。')
    }
    const usageRaw = record.usage
    const usage = typeof usageRaw === 'object' && usageRaw !== null &&
      typeof (usageRaw as Record<string, unknown>).prompt_tokens === 'number' &&
      typeof (usageRaw as Record<string, unknown>).completion_tokens === 'number'
      ? { promptTokens: (usageRaw as Record<string, number>).prompt_tokens, completionTokens: (usageRaw as Record<string, number>).completion_tokens }
      : null
    const choices = (record.choices as unknown[]).map((item): ChatChoice => {
      const choice = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
      const message = (typeof choice.message === 'object' && choice.message !== null ? choice.message : {}) as Record<string, unknown>
      const content = typeof message.content === 'string' ? message.content : ''
      const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : ''
      return {
        content,
        reasoning,
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : '',
        toolCalls: parseToolCalls(message.tool_calls)
      }
    })
    return { choices, usage, raw: parsed }
  } catch (error) {
    if (error instanceof LlmError) throw error
    if (options.signal?.aborted && !timedOut) throw new LlmError('REQUEST_TIMEOUT', '已停下。')
    if (timedOut) throw new LlmError('REQUEST_TIMEOUT', '模型服务请求超时。')
    if (controller.signal.aborted) throw new LlmError('REQUEST_TIMEOUT', '模型服务请求已取消。')
    throw new LlmError('NETWORK_ERROR', '无法连接模型服务，请检查地址、密钥和网络。')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}