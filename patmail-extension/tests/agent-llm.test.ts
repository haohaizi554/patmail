import { describe, expect, it } from 'vitest'
import { bindModelFallback, chatCompletion, LlmError, llmFailureKind, modelDialect, servedModel } from '../src/agent/llm'
import { AGENT_CONFIG_DEFAULT, AGENT_FALLBACK, fallbackAgentConfig, isAgentConfig, normalizeAgentConfig } from '../src/agent/config'

const config = { ...AGENT_CONFIG_DEFAULT, maxTokens: 100 }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('agent config', () => {
  it('accepts the default endpoint shape and rejects junk', () => {
    expect(isAgentConfig(AGENT_CONFIG_DEFAULT)).toBe(true)
    expect(isAgentConfig({ baseUrl: 'ftp://x', apiKey: '', model: '', maxTokens: -1 })).toBe(false)
    expect(isAgentConfig(null)).toBe(false)
    expect(normalizeAgentConfig({ ...config, baseUrl: ' http://a/v1/ ', model: ' m ' }).baseUrl).toBe('http://a/v1')
    expect(AGENT_CONFIG_DEFAULT.maxTokens).toBe(8192)
    expect(normalizeAgentConfig({ ...AGENT_CONFIG_DEFAULT, maxTokens: 1024 }).maxTokens).toBe(8192)
    expect(normalizeAgentConfig({ ...AGENT_CONFIG_DEFAULT, maxTokens: 1_048_576 }).maxTokens).toBe(8192)
    expect(normalizeAgentConfig({ ...AGENT_CONFIG_DEFAULT, maxTokens: 64 }).maxTokens).toBe(64)
    expect(normalizeAgentConfig({ ...AGENT_CONFIG_DEFAULT, maxTokens: 16384 }).maxTokens).toBe(16384)
  })
})

describe('llm failure kinds', () => {
  it('splits rate limit, auth, overflow and timeout without a fallback chain', () => {
    expect(llmFailureKind(new LlmError('HTTP_ERROR', 'slow', 429))).toBe('rate_limit')
    expect(llmFailureKind(new LlmError('HTTP_ERROR', '模型服务返回 HTTP 502。', 502))).toBe('upstream')
    expect(llmFailureKind(new LlmError('HTTP_ERROR', '模型服务返回 HTTP 503。', 503))).toBe('upstream')
    expect(llmFailureKind(new LlmError('HTTP_ERROR', 'no', 401))).toBe('auth')
    expect(llmFailureKind(new LlmError('HTTP_ERROR', 'maximum context length exceeded', 400))).toBe('overflow')
    expect(llmFailureKind(new LlmError('REQUEST_TIMEOUT', '模型服务请求超时。'))).toBe('timeout')
    expect(llmFailureKind(new LlmError('NETWORK_ERROR', '无法连接模型服务，请检查地址、密钥和网络。'))).toBe('transient')
  })
})

describe('chatCompletion', () => {
  it('posts to baseUrl/chat/completions with x-api-key and bearer headers', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })
    }) as typeof fetch
    const outcome = await chatCompletion(config, { messages: [{ role: 'user', content: '你好' }], fetcher })
    expect(capturedUrl).toBe('http://43.138.138.200:8588/v1/chat/completions')
    expect(capturedInit?.method).toBe('POST')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('x-api-key')).toBe(config.apiKey)
    expect(headers.get('authorization')).toBe(`Bearer ${config.apiKey}`)
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>
    expect(body.model).toBe(config.model)
    expect(body.max_tokens).toBe(100)
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(outcome.choices[0]?.reasoning).toBe('')
    expect(outcome.choices[0]?.content).toBe('你好')
    expect(outcome.usage).toEqual({ promptTokens: 5, completionTokens: 2 })
    expect(servedModel(outcome, config.model)).toBe(config.model)
  })

  it('reports the model name the server sent back', async () => {
    const fetcher = (async () => jsonResponse({
      model: 'Qwen3.6-35B-A3B-oQ4-fp16-mtp',
      choices: [{ message: { role: 'assistant', content: '在' }, finish_reason: 'stop' }]
    })) as typeof fetch
    const outcome = await chatCompletion(config, { messages: [{ role: 'user', content: '你好' }], fetcher })
    expect(servedModel(outcome, 'other')).toBe('Qwen3.6-35B-A3B-oQ4-fp16-mtp')
  })

  it('sends enable_thinking and keeps the reasoning chain when thinking is on', async () => {
    let captured = ''
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured = String(init?.body)
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: '结论', reasoning_content: '先核对字段' }, finish_reason: 'stop' }]
      })
    }) as typeof fetch
    const outcome = await chatCompletion({ ...config, thinking: true }, { messages: [{ role: 'user', content: '你好' }], fetcher })
    expect(JSON.parse(captured).chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(outcome.choices[0]?.content).toBe('结论')
    expect(outcome.choices[0]?.reasoning).toBe('先核对字段')
  })

  it('parses tool calls when the model asks for them', async () => {
    const fetcher = (async () => jsonResponse({
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_files', arguments: '{"q":"x"}' } }] },
        finish_reason: 'tool_calls'
      }]
    })) as typeof fetch
    const outcome = await chatCompletion(config, { messages: [{ role: 'user', content: '查一下' }], fetcher })
    expect(outcome.choices[0]?.toolCalls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'search_files', arguments: '{"q":"x"}' } }])
    expect(outcome.choices[0]?.finishReason).toBe('tool_calls')
  })

  it('maps HTTP errors to LlmError with status', async () => {
    const fetcher = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch
    await expect(chatCompletion(config, { messages: [{ role: 'user', content: 'hi' }], fetcher })).rejects.toSatisfy((error: unknown) => {
      return error instanceof LlmError && error.code === 'HTTP_ERROR' && error.status === 401
    })
  })

  it('rejects non-JSON responses as INVALID_RESPONSE', async () => {
    const fetcher = (async () => new Response('<html>bad</html>', { status: 200 })) as typeof fetch
    await expect(chatCompletion(config, { messages: [{ role: 'user', content: 'hi' }], fetcher })).rejects.toSatisfy((error: unknown) => {
      return error instanceof LlmError && error.code === 'INVALID_RESPONSE'
    })
  })

  it('times out into REQUEST_TIMEOUT', async () => {
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        const timer = setTimeout(_resolve, 200)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
      return jsonResponse({})
    }) as typeof fetch
    await expect(chatCompletion(config, { messages: [{ role: 'user', content: 'hi' }], fetcher, timeoutMs: 20 })).rejects.toSatisfy((error: unknown) => {
      return error instanceof LlmError && error.code === 'REQUEST_TIMEOUT'
    })
  })

  it('streams reasoning deltas and keeps the assembled answer', async () => {
    const events = [
      { choices: [{ delta: { reasoning_content: '先看文号' } }] },
      { choices: [{ delta: { reasoning_content: '，再回答' }, finish_reason: null }] },
      { choices: [{ delta: { content: '可以查。' }, finish_reason: 'stop' }] }
    ]
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).stream).toBe(true)
      const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch
    const seen: string[] = []
    const outcome = await chatCompletion(config, {
      messages: [{ role: 'user', content: '查一下' }],
      fetcher,
      onDelta: partial => seen.push(partial.reasoning)
    })
    expect(seen).toEqual(['先看文号', '先看文号，再回答', '先看文号，再回答'])
    expect(outcome.choices[0]?.reasoning).toBe('先看文号，再回答')
    expect(outcome.choices[0]?.content).toBe('可以查。')
  })

  it('talks to MiMo with api-key, thinking and max_completion_tokens', async () => {
    let captured = ''
    let headers: Headers | undefined
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = String(init?.body)
      headers = new Headers(init?.headers)
      expect(String(url)).toBe('https://api.xiaomimimo.com/v1/chat/completions')
      return jsonResponse({ choices: [{ message: { content: '我是备用。' }, finish_reason: 'stop' }] })
    }) as typeof fetch
    const backup = fallbackAgentConfig({ ...config, thinking: true })
    expect(modelDialect(backup)).toBe('mimo')
    expect(backup.model).toBe('mimo-v2.6-pro')
    const outcome = await chatCompletion(backup, { messages: [{ role: 'user', content: '你好' }], fetcher })
    const body = JSON.parse(captured) as Record<string, unknown>
    expect(body.model).toBe(AGENT_FALLBACK.model)
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.max_completion_tokens).toBe(100)
    expect(body.chat_template_kwargs).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
    expect(headers?.get('api-key')).toBe(AGENT_FALLBACK.apiKey)
    expect(headers?.get('authorization')).toBe(`Bearer ${AGENT_FALLBACK.apiKey}`)
    expect(outcome.choices[0]?.content).toBe('我是备用。')
  })
})

describe('model fallback', () => {
  it('uses the backup after the primary is unreachable and keeps it for the rest of the turn', async () => {
    const models: string[] = []
    let primaryCalls = 0
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; thinking?: { type: string } }
      models.push(body.model)
      if (String(url).includes('43.138.138.200')) {
        primaryCalls += 1
        return new Response('bad gateway', { status: 502 })
      }
      expect(body.thinking).toEqual({ type: 'disabled' })
      return jsonResponse({ choices: [{ message: { content: '备用接上了' }, finish_reason: 'stop' }] })
    }) as typeof fetch
    const notices: string[] = []
    const chat = bindModelFallback({ onSwitch: () => notices.push('switched') })
    const first = await chat(config, { messages: [{ role: 'user', content: '你好' }], fetcher })
    const second = await chat(config, { messages: [{ role: 'user', content: '再来' }], fetcher })
    expect(first.choices[0]?.content).toBe('备用接上了')
    expect(second.choices[0]?.content).toBe('备用接上了')
    expect(primaryCalls).toBe(1)
    expect(models).toEqual([config.model, 'mimo-v2.6-pro', 'mimo-v2.6-pro'])
    expect(notices).toEqual(['switched'])
  })

  it('does not switch when the primary rejects the key or the user stops', async () => {
    let calls = 0
    const denied = (async () => {
      calls += 1
      return new Response('unauthorized', { status: 401 })
    }) as typeof fetch
    await expect(bindModelFallback()(config, { messages: [{ role: 'user', content: 'hi' }], fetcher: denied })).rejects.toSatisfy((error: unknown) => {
      return error instanceof LlmError && error.status === 401
    })
    expect(calls).toBe(1)

    const stopped = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1
      init?.signal?.throwIfAborted?.()
      throw new DOMException('aborted', 'AbortError')
    }) as typeof fetch
    const signal = AbortSignal.abort()
    await expect(bindModelFallback()(config, { messages: [{ role: 'user', content: 'hi' }], fetcher: stopped, signal })).rejects.toSatisfy((error: unknown) => {
      return error instanceof LlmError && error.message === '已停下。'
    })
    expect(calls).toBe(2)
  })

  it('does not switch after the primary has already started streaming', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls += 1
      const encoder = new TextEncoder()
      let sent = false
      const stream = new ReadableStream({
        pull(controller) {
          if (!sent) {
            sent = true
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '半句' } }] })}\n\n`))
            return
          }
          controller.error(new Error('socket closed'))
        }
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch
    await expect(bindModelFallback()(config, {
      messages: [{ role: 'user', content: 'hi' }],
      fetcher,
      onDelta: () => {}
    })).rejects.toBeInstanceOf(LlmError)
    expect(calls).toBe(1)
  })
})