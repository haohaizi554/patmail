import { fallbackAgentConfig, usesFallbackEndpoint, type AgentConfig } from './config'

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

/** 服务端回传的 model 优先。没有这一栏时，用这次实际发出去的模型名。 */
export function servedModel(outcome: ChatOutcome, requested: string): string {
  const raw = outcome.raw
  if (typeof raw === 'object' && raw !== null) {
    const name = (raw as Record<string, unknown>).model
    if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 200)
  }
  return requested.trim().slice(0, 200)
}

export type LlmFailureKind = 'rate_limit' | 'upstream' | 'transient' | 'auth' | 'overflow' | 'timeout' | 'other'

export class LlmError extends Error {
  readonly code: 'NETWORK_ERROR' | 'REQUEST_TIMEOUT' | 'HTTP_ERROR' | 'INVALID_RESPONSE'
  readonly status?: number

  constructor(code: LlmError['code'], message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** 502 一类网关失败可以再试，认证失败不试。连不上时由备用模型接手，不在这里换。 */
export function llmFailureKind(error: LlmError): LlmFailureKind {
  if (error.code === 'REQUEST_TIMEOUT') return 'timeout'
  if (error.status === 429) return 'rate_limit'
  if (error.status === 502 || error.status === 503 || error.status === 504) return 'upstream'
  if (error.code === 'NETWORK_ERROR') return 'transient'
  if (error.status === 401 || error.status === 403) return 'auth'
  if (error.status === 413 || /context length|maximum context|too many tokens|context_length_exceeded/i.test(error.message)) return 'overflow'
  return 'other'
}

/** 主模型没接上、超时、被限流或没返回有效内容时换备用。认证失败、上下文过长和用户停下不换。 */
export function shouldFallbackModel(error: LlmError): boolean {
  if (error.message === '已停下。') return false
  const kind = llmFailureKind(error)
  if (kind === 'timeout' || kind === 'transient' || kind === 'upstream' || kind === 'rate_limit') return true
  if (error.status !== undefined && error.status >= 500) return true
  return error.code === 'INVALID_RESPONSE'
}

/** 小米 MiMo 用 thinking / api-key；本地 Qwen 用 chat_template_kwargs。 */
export function modelDialect(config: AgentConfig): 'qwen' | 'mimo' {
  try {
    if (new URL(config.baseUrl).hostname.endsWith('xiaomimimo.com')) return 'mimo'
  } catch {
    // 地址不合法时仍按主模型的请求格式发。
  }
  return 'qwen'
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
    // 本地端点用 x-api-key；小米端点用 api-key。Bearer 两边都带。
    'x-api-key': config.apiKey,
    ...(modelDialect(config) === 'mimo' ? { 'api-key': config.apiKey } : {}),
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'text/event-stream, application/json'
  }
}

function completionLimit(config: AgentConfig): Record<string, unknown> {
  if (config.maxTokens <= 0) return {}
  return modelDialect(config) === 'mimo'
    ? { max_completion_tokens: config.maxTokens }
    : { max_tokens: config.maxTokens }
}

function thinkingBody(config: AgentConfig): Record<string, unknown> {
  if (modelDialect(config) === 'mimo') return { thinking: { type: config.thinking ? 'enabled' : 'disabled' } }
  // Qwen3 系用这个字段开关思考链。关掉时必须显式传 false，只省略字段时服务端仍可能在想。
  return { chat_template_kwargs: { enable_thinking: config.thinking } }
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
        ...completionLimit(config),
        ...thinkingBody(config),
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

/**
 * 这一轮先打主模型。主模型不通就换备用，并在本轮后续请求里继续用备用。
 * 下一轮要重新 bind，好让主模型恢复后还能先试主模型。
 * 已经开始吐字的请求不改接备用，避免两段回答粘在一起。
 */
export function bindModelFallback(hooks?: { onSwitch?: () => void }): (config: AgentConfig, options: ChatOptions) => Promise<ChatOutcome> {
  let sticky = false
  let told = false
  return async (config, options) => {
    if (sticky) return chatCompletion(fallbackAgentConfig(config), options)
    if (usesFallbackEndpoint(config)) return chatCompletion(config, options)
    let streamed = false
    const watched: ChatOptions = options.onDelta
      ? { ...options, onDelta: partial => { streamed = true; options.onDelta?.(partial) } }
      : options
    try {
      return await chatCompletion(config, watched)
    } catch (error) {
      if (streamed || !(error instanceof LlmError) || !shouldFallbackModel(error)) throw error
      sticky = true
      if (!told) {
        told = true
        hooks?.onSwitch?.()
      }
      return chatCompletion(fallbackAgentConfig(config), options)
    }
  }
}

/** 单次调用的备用。对话一轮用 bindModelFallback，避免每一步都先撞主模型。 */
export function chatCompletionWithFallback(config: AgentConfig, options: ChatOptions): Promise<ChatOutcome> {
  return bindModelFallback()(config, options)
}