import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../../tests/mocks/debug'
mock.module('src/utils/debug.ts', debugMock)
import {
  adaptResponsesStreamToAnthropic,
  buildResponsesRequest,
  ChatGPTResponsesError,
  createChatGPTResponsesStream,
  extractUsage,
  messagesWithResponsesState,
  parseResponsesSSE,
} from '../responsesAdapter.js'
import { asSystemPrompt, type AssistantMessage } from '@ant/model-provider'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
} from '../../../langfuse/convert.js'
import { formatOpenAIPromptCacheKey } from '../openaiShared.js'
import { calculateCacheHitRate } from '../../../../utils/cacheWarning.js'

describe('buildResponsesRequest', () => {
  const promptCacheKey = formatOpenAIPromptCacheKey('session-abc-123')

  test('includes max reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'max',
      promptCacheKey,
    })

    expect(request.reasoning).toEqual({ effort: 'max' })
  })

  test('includes reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'xhigh',
      promptCacheKey,
    })

    expect(request.reasoning).toEqual({ effort: 'xhigh' })
  })

  test('does not include unsupported max_output_tokens parameter', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey,
    }) as Record<string, unknown>

    expect('max_output_tokens' in request).toBe(false)
  })

  test('includes stable prompt_cache_key for session-sticky cache routing', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey,
    })

    expect(request.prompt_cache_key).toBe('ccb:session-abc-123')
  })

  test('prompt_cache_key is stable across turns (not derived from messages)', () => {
    const key = formatOpenAIPromptCacheKey('same-session')
    const turn1 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'first' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })
    const turn2 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })

    expect(turn1.prompt_cache_key).toBe(turn2.prompt_cache_key)
    expect(turn1.prompt_cache_key).toBe('ccb:same-session')
  })
})

describe('extractUsage (OpenAI Responses → Anthropic usage)', () => {
  test('subtracts cached_tokens so hit rate uses OpenAI total as denominator', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 20_000 },
      },
    })

    expect(usage).toEqual({
      input_tokens: 10_000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 20_000,
    })

    // Was 40% under the double-count bug; correct is 66.7%.
    const hitRate = calculateCacheHitRate(usage)
    expect(hitRate).toBeCloseTo((20_000 / 30_000) * 100, 5)
  })

  test('full cache hit can report 100% (not capped at 50%)', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 30_000 },
      },
    })

    expect(usage.input_tokens).toBe(0)
    expect(usage.cache_read_input_tokens).toBe(30_000)
    expect(calculateCacheHitRate(usage)).toBe(100)
  })

  test('maps cache_write_tokens to cache_creation without double-counting total', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 10_000,
        output_tokens: 10,
        input_tokens_details: {
          cached_tokens: 6_000,
          cache_write_tokens: 2_000,
        },
      },
    })

    expect(usage).toEqual({
      input_tokens: 2_000,
      output_tokens: 10,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 6_000,
    })
    // segments sum to OpenAI total
    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(10_000)
    expect(calculateCacheHitRate(usage)).toBeCloseTo(60, 5)
  })

  test('clamps overlapping write/read that exceed total input', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 5_000,
        output_tokens: 0,
        input_tokens_details: {
          cached_tokens: 4_000,
          cache_write_tokens: 4_000,
        },
      },
    })

    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(5_000)
    expect(usage.cache_read_input_tokens).toBe(4_000)
    expect(usage.cache_creation_input_tokens).toBe(1_000)
    expect(usage.input_tokens).toBe(0)
  })
})

const nativeOutput = [
  {
    type: 'reasoning',
    id: 'rs_test',
    summary: [],
    encrypted_content: 'opaque-test-state',
  },
  {
    type: 'function_call',
    id: 'fc_test',
    call_id: 'call_test',
    name: 'read_file',
    namespace: 'local_tools',
    arguments: '{"path":"fixture.txt"}',
    status: 'completed',
  },
]

function completion(output: Record<string, unknown>[] = nativeOutput) {
  return {
    type: 'response.completed',
    response: {
      id: 'resp_test',
      status: 'completed',
      output,
      usage: { input_tokens: 12, output_tokens: 4 },
    },
  }
}

async function* events(values: Record<string, unknown>[]) {
  yield* values
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of stream) result.push(value)
  return result
}

function eventResponse(values: Record<string, unknown>[], crlf = false) {
  const newline = crlf ? '\r\n' : '\n'
  return new Response(
    values
      .map(value => `data: ${JSON.stringify(value)}${newline}${newline}`)
      .join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  )
}

const requestParams = {
  model: 'test-model',
  tools: [],
  toolChoice: undefined,
  promptCacheKey: 'test-session',
  messages: [{ role: 'user', content: 'hello' }],
  accountKey: 'test-account',
}

const testAuth = {
  accessToken: 'synthetic-access-not-real',
  accountKey: 'test-account',
  accountId: 'acct_test',
}

describe('subscription request contract and durable native history', () => {
  test('omits forbidden hosted and native tool-search definitions while retaining local MCP discovery functions', () => {
    const request = buildResponsesRequest({
      ...requestParams,
      tools: [
        { type: 'tool_search', function: { name: 'forbidden_search' } },
        { type: 'web_search', function: { name: 'forbidden_web' } },
        { type: 'mcp', function: { name: 'forbidden_hosted_mcp' } },
        {
          type: 'function',
          function: {
            name: 'SearchExtraTools',
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function',
          function: {
            name: 'ExecuteExtraTool',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    })
    const wire = JSON.stringify(request.tools)
    expect(wire).not.toContain('forbidden_')
    expect(wire).toContain('SearchExtraTools')
    expect(wire).toContain('ExecuteExtraTool')
    expect(request.tools?.every(tool => tool.type === 'namespace')).toBe(true)
  })

  test('groups only local functions in a namespace and keeps documented forced choice', () => {
    const request = buildResponsesRequest({
      ...requestParams,
      messages: [
        { role: 'developer', content: 'Use local tools.' },
        ...requestParams.messages,
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'read_file', parameters: { type: 'object' } },
        },
      ],
      toolChoice: { type: 'function', function: { name: 'read_file' } },
    })
    expect(request.tools).toEqual([
      {
        type: 'namespace',
        name: 'local_tools',
        description:
          'Local tools executed by the application after its permission checks.',
        tools: [
          {
            type: 'function',
            name: 'read_file',
            description: '',
            parameters: { type: 'object' },
            strict: false,
          },
        ],
      },
    ])
    expect(request.tool_choice).toEqual({ type: 'function', name: 'read_file' })
    expect(request.instructions).toBe('Use local tools.')
    expect(request.input).toEqual([{ role: 'user', content: 'hello' }])
    expect(request.stream).toBe(true)
    expect(request.store).toBe(false)
    for (const forbidden of [
      'previous_response_id',
      'temperature',
      'max_output_tokens',
      'metadata',
      'conversation',
    ]) {
      expect(forbidden in request).toBe(false)
    }
  })

  test('replays native reasoning exactly once after JSON transcript reload and split messages', () => {
    const message = {
      type: 'assistant',
      uuid: '00000000-0000-0000-0000-000000000001',
      message: {
        role: 'assistant',
        id: 'message_test',
        content: [
          {
            type: 'tool_use',
            id: 'call_test',
            name: 'read_file',
            input: { path: 'fixture.txt' },
          },
        ],
        chatgptResponses: {
          accountKey: 'test-account',
          model: 'test-model',
          responseId: 'resp_test',
          output: nativeOutput,
        },
      },
    } as AssistantMessage
    const reloaded = JSON.parse(
      JSON.stringify([message, message]),
    ) as AssistantMessage[]
    const messages = messagesWithResponsesState(
      reloaded,
      asSystemPrompt(['instructions']),
    )
    const request = buildResponsesRequest({
      ...requestParams,
      messages: [
        ...messages,
        {
          role: 'tool',
          tool_call_id: 'call_test',
          content: 'fixture contents',
        },
      ],
    })
    expect(request.input).toEqual([
      ...nativeOutput,
      {
        type: 'function_call_output',
        call_id: 'call_test',
        output: 'fixture contents',
      },
    ])
    expect(JSON.stringify(request)).not.toContain('test-account')
  })

  test.each([
    'another-account',
    undefined,
  ])('rejects opaque history under a different account (%s)', accountKey => {
    expect(() =>
      buildResponsesRequest({
        ...requestParams,
        accountKey,
        messages: [
          {
            role: 'assistant',
            chatgptResponses: {
              accountKey: 'test-account',
              model: 'test-model',
              responseId: 'resp_test',
              output: nativeOutput,
            },
          },
        ],
      }),
    ).toThrow(/new conversation/)
  })

  test('rejects cross-model opaque history and does not resurrect a removed compacted response', () => {
    expect(() =>
      buildResponsesRequest({
        ...requestParams,
        model: 'different-model',
        messages: [
          {
            role: 'assistant',
            chatgptResponses: {
              accountKey: 'test-account',
              model: 'test-model',
              responseId: 'resp_test',
              output: nativeOutput,
            },
          },
        ],
      }),
    ).toThrow(/new conversation/)
    const compacted = buildResponsesRequest({
      ...requestParams,
      messages: [{ role: 'user', content: 'Summary of earlier work' }],
    })
    expect(compacted.input).toEqual([
      { role: 'user', content: 'Summary of earlier work' },
    ])
  })

  test('telemetry projects display content without native encrypted state', () => {
    const message = {
      type: 'assistant',
      uuid: '00000000-0000-0000-0000-000000000001',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'visible answer' }],
        chatgptResponses: {
          accountKey: 'test-account',
          model: 'test-model',
          responseId: 'resp_test',
          output: nativeOutput,
        },
      },
    } as AssistantMessage
    const trace = {
      input: convertMessagesToLangfuse([message]),
      output: convertOutputToLangfuse([message]),
    }
    expect(JSON.stringify(trace)).toContain('visible answer')
    expect(JSON.stringify(trace)).not.toContain('opaque-test-state')
    expect(JSON.stringify(trace)).not.toContain('chatgptResponses')
    expect(JSON.stringify(trace)).not.toContain('test-account')
  })
})

describe('bounded Responses SSE parsing', () => {
  test('parses CRLF, comments, multiline data and fragmented UTF-8', async () => {
    const payload =
      ': heartbeat\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"h?llo ??"}\r\n\r\n'
    const bytes = new TextEncoder().encode(payload)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i++)
          controller.enqueue(bytes.slice(i, i + 1))
        controller.close()
      },
    })
    expect(await collect(parseResponsesSSE(new Response(body)))).toEqual([
      { type: 'response.output_text.delta', delta: 'h?llo ??' },
    ])
  })

  test.each([
    'data: {bad}\n\n',
    'data: []\n\n',
    'data: {"type":"x"}',
  ])('rejects malformed or truncated frames', async payload => {
    await expect(
      collect(parseResponsesSSE(new Response(payload))),
    ).rejects.toThrow(/invalid|inside an event/)
  })

  test('rejects an oversized event', async () => {
    await expect(
      collect(
        parseResponsesSSE(
          new Response(`data: ${'x'.repeat(8 * 1024 * 1024 + 1)}`),
        ),
      ),
    ).rejects.toThrow(/size limit/)
  })

  test('cancels a pending read and releases the stream on abort', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
    )
    const controller = new AbortController()
    const pending = parseResponsesSSE(response, controller.signal).next()
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(cancelled).toBe(true)
    expect(response.body?.locked).toBe(false)
  })

  test('closes the underlying reader when its consumer stops early', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"x"}\n\n'))
        },
        cancel() {
          cancelled = true
        },
      }),
    )
    for await (const _event of parseResponsesSSE(response)) break
    expect(cancelled).toBe(true)
    expect(response.body?.locked).toBe(false)
  })
})

describe('Responses completion is the tool execution commit point', () => {
  test('does not emit any tool block until the completed response is validated', async () => {
    let upstreamCompleted = false
    async function* source() {
      yield {
        type: 'response.output_item.added',
        output_index: 0,
        item: nativeOutput[1],
      }
      yield {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '{"partial":',
      }
      upstreamCompleted = true
      yield completion()
    }
    let state: unknown
    const output = []
    for await (const event of adaptResponsesStreamToAnthropic(
      source(),
      'test-model',
      {
        accountKey: 'test-account',
        onCompleted(value) {
          state = value
        },
      },
    )) {
      if (
        event.type === 'content_block_start' &&
        event.content_block.type === 'tool_use'
      ) {
        expect(upstreamCompleted).toBe(true)
        expect(event.content_block.name).toBe('read_file')
      }
      output.push(event)
    }
    expect(output.filter(value => value.type === 'message_stop')).toHaveLength(
      1,
    )
    expect(
      output.filter(value => value.type === 'content_block_delta'),
    ).toContainEqual({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"path":"fixture.txt"}',
      },
    })
    expect(state).toEqual({
      accountKey: 'test-account',
      model: 'test-model',
      responseId: 'resp_test',
      output: nativeOutput,
    })
  })

  test.each([
    'response.failed',
    'response.incomplete',
    'error',
  ])('rejects %s without exposing error bodies or committing tools', async type => {
    const emitted: unknown[] = []
    const run = async () => {
      for await (const event of adaptResponsesStreamToAnthropic(
        events([
          { type: 'response.output_item.added', item: nativeOutput[1] },
          {
            type,
            error: {
              code: 'subscription_sharing_usage_limit_exceeded',
              message: 'secret-body-not-for-user',
            },
          },
        ]),
        'test-model',
      ))
        emitted.push(event)
    }
    const error = await run().catch(error => error as ChatGPTResponsesError)
    expect(error).toBeInstanceOf(ChatGPTResponsesError)
    if (!(error instanceof ChatGPTResponsesError))
      throw new Error('Expected a Responses failure')
    expect(error.message).not.toContain('secret-body-not-for-user')
    expect(JSON.stringify(emitted)).not.toContain('tool_use')
    expect(JSON.stringify(emitted)).not.toContain('message_stop')
  })

  test('rejects EOF after tool deltas without an executable tool or final message', async () => {
    const emitted: unknown[] = []
    await expect(
      (async () => {
        for await (const event of adaptResponsesStreamToAnthropic(
          events([
            { type: 'response.output_item.added', item: nativeOutput[1] },
            {
              type: 'response.function_call_arguments.delta',
              output_index: 0,
              delta: '{}',
            },
          ]),
          'test-model',
        ))
          emitted.push(event)
      })(),
    ).rejects.toThrow(/without response.completed/)
    expect(JSON.stringify(emitted)).not.toContain('tool_use')
  })

  test.each([
    { ...nativeOutput[1], arguments: '{broken' },
    { ...nativeOutput[1], arguments: 'null' },
    { ...nativeOutput[1], namespace: 'foreign_tools' },
    { ...nativeOutput[1], status: 'incomplete' },
  ])('rejects invalid final tool output before any tool blocks', async item => {
    const emitted: unknown[] = []
    await expect(
      (async () => {
        for await (const event of adaptResponsesStreamToAnthropic(
          events([completion([item])]),
          'test-model',
        ))
          emitted.push(event)
      })(),
    ).rejects.toThrow()
    expect(JSON.stringify(emitted)).not.toContain('tool_use')
  })

  test('uses completed output order for interleaved function deltas and returns tool_use stop reason', async () => {
    const second = {
      ...nativeOutput[1],
      id: 'fc_second',
      call_id: 'call_second',
      name: 'search_file',
      arguments: '{}',
    }
    const result = await collect(
      adaptResponsesStreamToAnthropic(
        events([
          {
            type: 'response.function_call_arguments.delta',
            output_index: 2,
            delta: '{ignored',
          },
          completion([nativeOutput[0]!, second, nativeOutput[1]!]),
        ]),
        'test-model',
      ),
    )
    const starts = result.filter(event => event.type === 'content_block_start')
    expect(
      starts.map(event =>
        event.content_block.type === 'tool_use' ? event.content_block.name : '',
      ),
    ).toEqual(['search_file', 'read_file'])
    const terminalDelta = result.find(event => event.type === 'message_delta')
    expect(terminalDelta).toMatchObject({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    })
  })

  test('uses output_item.done items when the completed output is empty', async () => {
    let state: { output: unknown[] } | undefined
    const result = await collect(
      adaptResponsesStreamToAnthropic(
        events([
          ...nativeOutput.map(item => ({
            type: 'response.output_item.done',
            item,
          })),
          completion([]),
        ]),
        'test-model',
        { accountKey: 'test-account', onCompleted: s => (state = s) },
      ),
    )
    const tools = result.filter(
      event =>
        event.type === 'content_block_start' &&
        event.content_block.type === 'tool_use',
    )
    expect(tools).toHaveLength(1)
    expect(result.find(event => event.type === 'message_delta')).toMatchObject({
      delta: { stop_reason: 'tool_use' },
    })
    expect(state?.output).toEqual(nativeOutput)
  })
})

describe('subscription transport isolation', () => {
  test('does not display credential-shaped strings supplied as provider error codes', async () => {
    const failure = await createChatGPTResponsesStream({
      auth: testAuth,
      request: buildResponsesRequest(requestParams),
      signal: new AbortController().signal,
      fetchOverride: (async () =>
        Response.json(
          { error: { code: 'sk-synthetic-private-token' } },
          { status: 401 },
        )) as unknown as typeof fetch,
    }).catch(error => error as ChatGPTResponsesError)
    expect(failure).toBeInstanceOf(ChatGPTResponsesError)
    const error = failure as ChatGPTResponsesError
    expect(error.code).toBeUndefined()
    expect(error.message).not.toContain('sk-synthetic-private-token')
    expect(error.message).toContain('/login')
  })

  test('sends app-owned bearer credentials only to the fixed public HTTPS endpoint', async () => {
    let seen: { url: string; init?: RequestInit } | undefined
    const stream = await createChatGPTResponsesStream({
      auth: testAuth,
      request: buildResponsesRequest(requestParams),
      signal: new AbortController().signal,
      fetchOverride: (async (url: RequestInfo | URL, init?: RequestInit) => {
        seen = { url: String(url), init }
        return eventResponse([completion()])
      }) as typeof fetch,
    })
    await collect(stream)
    expect(seen?.url).toBe('https://api.openai.com/v1/responses')
    expect(seen?.init?.redirect).toBe('error')
    const headers = new Headers(seen?.init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${testAuth.accessToken}`)
    expect(headers.has('origin')).toBe(false)
    expect(headers.has('referer')).toBe(false)
    expect(headers.has('ChatGPT-Account-Id')).toBe(false)
  })

  test('accepts a valid event stream sent without a Content-Type header', async () => {
    const body = await eventResponse([completion()]).arrayBuffer()
    const stream = await createChatGPTResponsesStream({
      auth: testAuth,
      request: buildResponsesRequest(requestParams),
      signal: new AbortController().signal,
      fetchOverride: (async () => {
        const response = new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(body))
              controller.close()
            },
          }),
        )
        expect(response.headers.get('content-type')).toBeNull()
        return response
      }) as unknown as typeof fetch,
    })
    const events = await collect(stream)
    expect(events.at(-1)?.type).toBe('response.completed')
  })

  test('rejects an explicitly non-streaming success response', async () => {
    const failure = await createChatGPTResponsesStream({
      auth: testAuth,
      request: buildResponsesRequest(requestParams),
      signal: new AbortController().signal,
      fetchOverride: (async () =>
        Response.json({ ok: true })) as unknown as typeof fetch,
    }).catch(error => error as ChatGPTResponsesError)
    expect(failure).toBeInstanceOf(ChatGPTResponsesError)
    expect((failure as Error).message).toContain('non-streaming')
  })

  test('preserves safe status/code/request ID without leaking provider body content', async () => {
    const failure = await createChatGPTResponsesStream({
      auth: testAuth,
      request: buildResponsesRequest(requestParams),
      signal: new AbortController().signal,
      fetchOverride: (async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'subscription_sharing_usage_unavailable',
              message: 'synthetic-secret-must-stay-private',
            },
          }),
          { status: 403, headers: { 'x-request-id': 'req_test' } },
        )) as unknown as typeof fetch,
    }).catch(error => error as ChatGPTResponsesError)
    expect(failure).toBeInstanceOf(ChatGPTResponsesError)
    const error = failure as ChatGPTResponsesError
    expect(error.status).toBe(403)
    expect(error.code).toBe('subscription_sharing_usage_unavailable')
    expect(error.requestId).toBe('req_test')
    expect(error.message).toContain('https://chatgpt.com/settings/usage')
    expect(error.message).not.toContain('synthetic-secret-must-stay-private')
  })
})
