import { describe, expect, it } from 'vitest'
import { chatCompletion, LlmError } from '../src/agent/llm'
import { AGENT_CONFIG_DEFAULT, isAgentConfig, normalizeAgentConfig } from '../src/agent/config'

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
})