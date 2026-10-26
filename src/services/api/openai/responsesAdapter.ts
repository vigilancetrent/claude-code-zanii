import { randomUUID } from 'crypto'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  anthropicMessagesToOpenAI,
  asSystemPrompt,
  normalizeOpenAIUsage,
  type AnthropicUsage,
  type AssistantMessage,
  type ChatGPTResponsesState,
  type UserMessage,
  type SystemPrompt,
} from '@ant/model-provider'
import { getValidChatGPTAuth, type ChatGPTAuth } from './chatgptAuth.js'
import { CHATGPT_USAGE_URL } from '../../../utils/model/chatgptModels.js'

const TOOL_NAMESPACE = 'local_tools'
const MAX_EVENT_BYTES = 8 * 1024 * 1024
const MAX_STREAM_BYTES = 64 * 1024 * 1024
const MAX_OUTPUT_ITEMS = 4096

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w.:-]{1,200}$/.test(value)
    ? value
    : undefined
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(value)
    ? value
    : undefined
}

export class ChatGPTResponsesError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    const recovery =
      code === 'subscription_sharing_usage_limit_exceeded' ||
      code === 'subscription_sharing_usage_unavailable'
        ? ` Check ChatGPT usage at ${CHATGPT_USAGE_URL}.`
        : status === 401 || code === 'subscription_sharing_invalid_user'
          ? ' Reconnect your ChatGPT account with /login.'
          : code === 'subscription_sharing_user_not_eligible'
            ? ' This ChatGPT account or workspace is not eligible for plan usage.'
            : ''
    super(
      `${message}${code ? ` [${code}]` : ''}${requestId ? ` (request ${requestId})` : ''}${recovery}`,
    )
    this.name = 'ChatGPTResponsesError'
  }
}

export function messagesWithResponsesState(
  messages: (AssistantMessage | UserMessage)[],
  systemPrompt: SystemPrompt,
): unknown[] {
  const result: unknown[] = anthropicMessagesToOpenAI([], systemPrompt)
  const responseStates = new Map<string, ChatGPTResponsesState>()
  const responseSiblings = new Map<string, AssistantMessage[]>()
  for (const message of messages) {
    if (message.type === 'assistant' && message.message.id) {
      const siblings = responseSiblings.get(message.message.id) ?? []
      siblings.push(message)
      responseSiblings.set(message.message.id, siblings)
      if (message.message.chatgptResponses) {
        responseStates.set(message.message.id, message.message.chatgptResponses)
      }
    }
  }
  for (const [id, state] of responseStates) {
    const output = validateOutputItems(state.output)
    const siblings = responseSiblings.get(id) ?? []
    let visibleText = ''
    const calls = new Map<string, { name: string; input: unknown }>()
    for (const sibling of siblings) {
      const content = sibling.message.content
      if (typeof content === 'string') visibleText += content
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') visibleText += block.text
          else if (block.type === 'tool_use') calls.set(block.id, block)
        }
      }
    }
    const nativeText = output
      .filter(item => item.type === 'message')
      .flatMap(item => item.content as Record<string, unknown>[])
      .map(part => (part.type === 'refusal' ? part.refusal : part.text))
      .join('')
    const nativeCalls = output.filter(item => item.type === 'function_call')
    if (
      nativeText !== visibleText ||
      nativeCalls.length !== calls.size ||
      nativeCalls.some(
        item => calls.get(String(item.call_id))?.name !== functionName(item),
      )
    ) {
      // Interrupted or edited turn: drop the native items so removed content is
      // never replayed, and fall back to the visible blocks instead of failing
      // every later request in the session.
      responseStates.delete(id)
      continue
    }
    responseStates.set(id, {
      ...state,
      output: output.map(item => {
        if (item.type !== 'function_call') return item
        const input = calls.get(String(item.call_id))!.input
        return {
          ...item,
          arguments: typeof input === 'string' ? input : JSON.stringify(input),
        }
      }),
    })
  }
  for (const message of messages) {
    const converted = anthropicMessagesToOpenAI([message], asSystemPrompt([]))
    const state =
      message.type !== 'assistant'
        ? undefined
        : message.message.id
          ? responseStates.get(message.message.id)
          : message.message.chatgptResponses
    result.push(
      ...converted.map(item =>
        item.role === 'assistant' && state
          ? { ...item, chatgptResponses: state }
          : item,
      ),
    )
  }
  return result
}

type ResponsesInputItem = Record<string, unknown>
type ResponsesTool = Record<string, unknown>
export type ResponsesReasoningEffort =
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

type ResponsesRequest = {
  model: string
  stream: true
  store: false
  input: ResponsesInputItem[]
  instructions?: string
  tools?: ResponsesTool[]
  tool_choice?: unknown
  reasoning?: { effort: ResponsesReasoningEffort }
  parallel_tool_calls?: boolean
  /** Sticky cache routing key — stable for the CCB session. */
  prompt_cache_key: string
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function convertUserContent(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return textFromContent(content)
  const result: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      result.push({ type: 'input_text', text: record.text })
    } else if (record.type === 'image_url') {
      const imageUrl = record.image_url as Record<string, unknown> | undefined
      if (typeof imageUrl?.url === 'string') {
        result.push({ type: 'input_image', image_url: imageUrl.url })
      }
    }
  }
  return result.length > 0 ? result : textFromContent(content)
}

function convertMessagesToResponsesInput(
  messages: unknown[],
  context: { model: string; accountKey?: string },
): {
  input: ResponsesInputItem[]
  instructions?: string
} {
  const input: ResponsesInputItem[] = []
  const instructions: string[] = []
  const replayed = new Set<string>()

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    const role = record.role

    if (role === 'system' || role === 'developer') {
      const text = textFromContent(record.content)
      if (text) instructions.push(text)
      continue
    }

    if (role === 'tool') {
      const callId = record.tool_call_id
      if (typeof callId === 'string') {
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: textFromContent(record.content),
        })
      }
      continue
    }

    if (role === 'assistant') {
      const state = asRecord(record.chatgptResponses)
      if (state) {
        if (
          typeof state.responseId !== 'string' ||
          typeof state.accountKey !== 'string' ||
          state.model !== context.model ||
          state.accountKey !== context.accountKey
        ) {
          throw new ChatGPTResponsesError(
            'Start a new conversation after changing the ChatGPT account or model.',
          )
        }
        if (replayed.has(state.responseId)) continue
        replayed.add(state.responseId)
        input.push(...validateOutputItems(state.output))
        continue
      }
      const text = textFromContent(record.content)
      if (text) {
        input.push({ role: 'assistant', content: text })
      }
      const toolCalls = record.tool_calls
      if (Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          if (!toolCall || typeof toolCall !== 'object') continue
          const tc = toolCall as Record<string, unknown>
          const fn = tc.function as Record<string, unknown> | undefined
          const id = typeof tc.id === 'string' ? tc.id : undefined
          const name = typeof fn?.name === 'string' ? fn.name : undefined
          if (!id || !name) continue
          input.push({
            type: 'function_call',
            call_id: id,
            name,
            namespace: TOOL_NAMESPACE,
            arguments: typeof fn?.arguments === 'string' ? fn.arguments : '{}',
          })
        }
      }
      continue
    }

    if (role === 'user') {
      input.push({
        role: 'user',
        content: convertUserContent(record.content),
      })
    }
  }

  return {
    input,
    instructions:
      instructions.length > 0 ? instructions.join('\n\n') : undefined,
  }
}

function convertToolsToResponses(tools: unknown[]): ResponsesTool[] {
  const result: ResponsesTool[] = []
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue
    const record = tool as Record<string, unknown>
    if (record.type !== 'function') continue
    const fn = record.function as Record<string, unknown> | undefined
    const name = typeof fn?.name === 'string' ? fn.name : undefined
    if (!name) continue
    result.push({
      type: 'function',
      name,
      description: typeof fn?.description === 'string' ? fn.description : '',
      parameters:
        fn?.parameters && typeof fn.parameters === 'object'
          ? fn.parameters
          : { type: 'object', properties: {} },
      strict: false,
    })
  }
  return result.length > 0
    ? [
        {
          type: 'namespace',
          name: TOOL_NAMESPACE,
          description:
            'Local tools executed by the application after its permission checks.',
          tools: result,
        },
      ]
    : []
}

function convertToolChoiceToResponses(toolChoice: unknown): unknown {
  if (toolChoice === 'required') return 'required'
  if (toolChoice === 'auto') return 'auto'
  if (!toolChoice || typeof toolChoice !== 'object') return toolChoice
  const record = toolChoice as Record<string, unknown>
  const fn = record.function as Record<string, unknown> | undefined
  if (record.type === 'function' && typeof fn?.name === 'string') {
    return { type: 'function', name: fn.name }
  }
  return toolChoice
}

export function buildResponsesRequest(params: {
  model: string
  messages: unknown[]
  tools: unknown[]
  toolChoice: unknown
  reasoningEffort?: ResponsesReasoningEffort
  /** Session-scoped key supplied only by the ChatGPT OAuth route. */
  promptCacheKey: string
  accountKey?: string
}): ResponsesRequest {
  const { input, instructions } = convertMessagesToResponsesInput(
    params.messages,
    params,
  )
  const tools = convertToolsToResponses(params.tools)
  return {
    model: params.model,
    stream: true,
    store: false,
    input,
    instructions: instructions || 'You are a helpful coding assistant.',
    ...(tools.length > 0 ? { tools } : {}),
    ...(params.toolChoice
      ? { tool_choice: convertToolChoiceToResponses(params.toolChoice) }
      : {}),
    ...(params.reasoningEffort
      ? { reasoning: { effort: params.reasoningEffort } }
      : {}),
    parallel_tool_calls: true,
    // Same OAuth session → same key so OpenAI can sticky-route to a cache node.
    // Must not hash the full message list (would change every turn).
    prompt_cache_key: params.promptCacheKey,
  }
}

export async function* parseResponsesSSE(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>, void> {
  if (!response.body) {
    throw new ChatGPTResponsesError('ChatGPT response did not include a body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let data: string[] = []
  let frameSize = 0
  let totalBytes = 0
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    while (true) {
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) {
        buffer += decoder.decode()
        if (buffer.trim() || data.length > 0) {
          throw new ChatGPTResponsesError(
            'ChatGPT stream ended inside an event',
          )
        }
        return
      }
      totalBytes += value.byteLength
      if (totalBytes > MAX_STREAM_BYTES) {
        throw new ChatGPTResponsesError(
          'ChatGPT stream exceeded its size limit',
        )
      }
      buffer += decoder.decode(value, { stream: true })
      let splitAt = buffer.indexOf('\n')
      while (splitAt >= 0) {
        const line = buffer.slice(0, splitAt).replace(/\r$/, '')
        buffer = buffer.slice(splitAt + 1)
        frameSize += line.length
        if (frameSize > MAX_EVENT_BYTES) {
          throw new ChatGPTResponsesError(
            'ChatGPT event exceeded its size limit',
          )
        }
        if (line === '') {
          if (data.length > 0) {
            const payload = data.join('\n')
            data = []
            if (payload !== '[DONE]') {
              let parsed: Record<string, unknown> | undefined
              try {
                parsed = asRecord(JSON.parse(payload))
              } catch {
                throw new ChatGPTResponsesError(
                  'ChatGPT returned an invalid stream event',
                )
              }
              if (!parsed || typeof parsed.type !== 'string') {
                throw new ChatGPTResponsesError(
                  'ChatGPT returned an invalid stream event',
                )
              }
              yield parsed
            }
          }
          frameSize = 0
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
        splitAt = buffer.indexOf('\n')
      }
      if (buffer.length + frameSize > MAX_EVENT_BYTES) {
        throw new ChatGPTResponsesError('ChatGPT event exceeded its size limit')
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function functionName(item: Record<string, unknown>): string {
  if (item.namespace !== undefined && item.namespace !== TOOL_NAMESPACE) {
    throw new ChatGPTResponsesError(
      'ChatGPT returned an unsupported tool namespace',
    )
  }
  const name =
    typeof item.name === 'string' ? item.name.replace(/^local_tools\./, '') : ''
  if (!/^[\w-]{1,128}$/.test(name)) {
    throw new ChatGPTResponsesError('ChatGPT returned an invalid tool name')
  }
  return name
}

function validateFunctionArguments(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_EVENT_BYTES) {
    throw new ChatGPTResponsesError(
      'ChatGPT returned invalid function arguments',
    )
  }
  try {
    if (!asRecord(JSON.parse(value))) throw new Error()
  } catch {
    throw new ChatGPTResponsesError(
      'ChatGPT returned invalid function arguments',
    )
  }
  return value
}

function validateOutputItems(value: unknown): ResponsesInputItem[] {
  if (!Array.isArray(value) || value.length > MAX_OUTPUT_ITEMS) {
    throw new ChatGPTResponsesError('ChatGPT returned invalid response output')
  }
  if (JSON.stringify(value).length > MAX_EVENT_BYTES) {
    throw new ChatGPTResponsesError(
      'ChatGPT response output exceeded its size limit',
    )
  }
  const callIds = new Set<string>()
  return value.map(value => {
    const item = asRecord(value)
    if (!item || (item.status !== undefined && item.status !== 'completed')) {
      throw new ChatGPTResponsesError(
        'ChatGPT returned incomplete response output',
      )
    }
    if (item.type === 'function_call') {
      functionName(item)
      validateFunctionArguments(item.arguments)
      const callId = safeIdentifier(item.call_id)
      if (!callId || callIds.has(callId)) {
        throw new ChatGPTResponsesError(
          'ChatGPT returned duplicate or invalid tool call IDs',
        )
      }
      callIds.add(callId)
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content)) {
        throw new ChatGPTResponsesError(
          'ChatGPT returned an invalid assistant message',
        )
      }
      for (const content of item.content) {
        const part = asRecord(content)
        if (
          !part ||
          !(
            (part.type === 'output_text' && typeof part.text === 'string') ||
            (part.type === 'refusal' && typeof part.refusal === 'string')
          )
        ) {
          throw new ChatGPTResponsesError(
            'ChatGPT returned invalid message content',
          )
        }
      }
    } else if (item.type === 'reasoning' || item.type === 'compaction') {
      if (
        item.encrypted_content !== undefined &&
        typeof item.encrypted_content !== 'string'
      ) {
        throw new ChatGPTResponsesError(
          'ChatGPT returned invalid reasoning state',
        )
      }
    } else {
      throw new ChatGPTResponsesError(
        'ChatGPT returned an unsupported output item',
      )
    }
    return item
  })
}

/**
 * Map OpenAI Responses usage → Anthropic-style mutually exclusive fields.
 *
 * OpenAI:  input_tokens is TOTAL input; cached_tokens ⊆ input_tokens;
 *          cache_write_tokens (GPT-5.6+) reports tokens written this turn.
 * Anthropic: input + cache_creation + cache_read are disjoint and sum to total.
 *
 * Without subtracting cached from input, cacheWarning hit-rate becomes
 * cached/(total+cached) with a hard ceiling of 50%.
 */
export function extractUsage(
  response: Record<string, unknown> | undefined,
): AnthropicUsage {
  const usage = response?.usage as Record<string, unknown> | undefined
  const inputDetails = usage?.input_tokens_details as
    | Record<string, unknown>
    | undefined

  const totalInput =
    typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0
  const outputTokens =
    typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0

  const cachedRaw =
    typeof inputDetails?.cached_tokens === 'number'
      ? inputDetails.cached_tokens
      : 0
  const writeRaw =
    typeof inputDetails?.cache_write_tokens === 'number'
      ? inputDetails.cache_write_tokens
      : 0

  return normalizeOpenAIUsage({
    totalInputTokens: totalInput,
    outputTokens,
    cacheReadTokens: cachedRaw,
    cacheWriteTokens: writeRaw,
  })
}

export async function* adaptResponsesStreamToAnthropic(
  stream: AsyncIterable<Record<string, unknown>>,
  model: string,
  options?: {
    accountKey: string
    onCompleted?: (state: ChatGPTResponsesState) => void
  },
): AsyncGenerator<BetaRawMessageStreamEvent, void> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  let started = false
  let contentIndex = -1
  let openBlock: 'text' | 'thinking' | undefined
  let receivedText = false

  for await (const event of stream) {
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      } as unknown as BetaRawMessageStreamEvent
    }

    const isText =
      event.type === 'response.output_text.delta' ||
      event.type === 'response.refusal.delta'
    const isThinking =
      event.type === 'response.reasoning_text.delta' ||
      event.type === 'response.reasoning_summary_text.delta'
    if (isText || isThinking) {
      if (typeof event.delta !== 'string') {
        throw new ChatGPTResponsesError(
          'ChatGPT returned an invalid text event',
        )
      }
      const blockType = isText ? 'text' : 'thinking'
      if (openBlock !== blockType) {
        if (openBlock) {
          yield { type: 'content_block_stop', index: contentIndex }
        }
        contentIndex++
        openBlock = blockType
        yield {
          type: 'content_block_start',
          index: contentIndex,
          content_block: isText
            ? { type: 'text', text: '' }
            : { type: 'thinking', thinking: '', signature: '' },
        } as BetaRawMessageStreamEvent
      }
      if (isText) receivedText = true
      yield {
        type: 'content_block_delta',
        index: contentIndex,
        delta: isText
          ? { type: 'text_delta', text: event.delta }
          : { type: 'thinking_delta', thinking: event.delta },
      } as BetaRawMessageStreamEvent
      continue
    }

    if (
      event.type === 'error' ||
      event.type === 'response.error' ||
      event.type === 'response.failed' ||
      event.type === 'response.incomplete'
    ) {
      const response = asRecord(event.response)
      const error = asRecord(event.error) ?? asRecord(response?.error) ?? event
      throw new ChatGPTResponsesError(
        event.type === 'response.incomplete'
          ? 'ChatGPT response was incomplete; no tool calls were executed.'
          : 'ChatGPT Responses API failed',
        undefined,
        safeErrorCode(error.code),
        safeIdentifier(event.request_id ?? response?.request_id),
      )
    }

    if (event.type === 'response.completed') {
      const response = asRecord(event.response)
      if (response?.status !== 'completed' || !safeIdentifier(response.id)) {
        throw new ChatGPTResponsesError(
          'ChatGPT returned an invalid completion event',
        )
      }
      const output = validateOutputItems(response.output)
      if (openBlock) {
        yield { type: 'content_block_stop', index: contentIndex }
        openBlock = undefined
      }
      // A completed response is the commit point for local tool execution.
      // Earlier tool deltas may belong to a response that ultimately fails.
      for (const item of output) {
        if (item.type === 'function_call') {
          contentIndex++
          yield {
            type: 'content_block_start',
            index: contentIndex,
            content_block: {
              type: 'tool_use',
              id: String(item.call_id),
              name: functionName(item),
              input: {},
            },
          } as BetaRawMessageStreamEvent
          yield {
            type: 'content_block_delta',
            index: contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: String(item.arguments),
            },
          } as BetaRawMessageStreamEvent
          yield { type: 'content_block_stop', index: contentIndex }
        } else if (item.type === 'message' && !receivedText) {
          const text = (item.content as Record<string, unknown>[])
            .map(part => (part.type === 'refusal' ? part.refusal : part.text))
            .join('')
          if (text) {
            contentIndex++
            yield {
              type: 'content_block_start',
              index: contentIndex,
              content_block: { type: 'text', text: '' },
            } as BetaRawMessageStreamEvent
            yield {
              type: 'content_block_delta',
              index: contentIndex,
              delta: { type: 'text_delta', text },
            } as BetaRawMessageStreamEvent
            yield { type: 'content_block_stop', index: contentIndex }
          }
        }
      }
      if (options) {
        options.onCompleted?.({
          accountKey: options.accountKey,
          model,
          responseId: String(response.id),
          output,
        })
      }
      yield {
        type: 'message_delta',
        delta: {
          stop_reason: output.some(item => item.type === 'function_call')
            ? 'tool_use'
            : 'end_turn',
          stop_sequence: null,
        },
        usage: extractUsage(response),
      } as unknown as BetaRawMessageStreamEvent
      yield { type: 'message_stop' }
      return
    }
  }
  throw new ChatGPTResponsesError(
    'ChatGPT stream ended without response.completed',
  )
}

export async function createChatGPTResponsesStream(params: {
  request: ResponsesRequest
  signal: AbortSignal
  auth?: ChatGPTAuth
  fetchOverride?: typeof fetch
}): Promise<AsyncIterable<Record<string, unknown>>> {
  const timeout = Number(process.env.API_TIMEOUT_MS ?? 600_000)
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > 2_147_483_647
  ) {
    throw new ChatGPTResponsesError(
      'API_TIMEOUT_MS must be a positive integer below 2147483648',
    )
  }
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(timeout)])
  signal.throwIfAborted()
  const auth = params.auth ?? (await getValidChatGPTAuth(signal))
  const fetchFn = params.fetchOverride ?? globalThis.fetch
  const response = await fetchFn('https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      originator: 'claude-code-zanii',
    },
    body: JSON.stringify(params.request),
    signal,
  })
  if (!response.ok) {
    let code: string | undefined
    const requestId = safeIdentifier(response.headers.get('x-request-id'))
    // Error bodies are untrusted and can contain credentials or user content.
    // Keep a bounded machine code and request ID, never the raw body/message.
    if (response.body) {
      const reader = response.body.getReader()
      let size = 0
      const chunks: Uint8Array[] = []
      try {
        while (size <= 64 * 1024) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size <= 64 * 1024) chunks.push(value)
        }
        if (size <= 64 * 1024) {
          const body = asRecord(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
          )
          code = safeErrorCode(asRecord(body?.error)?.code ?? body?.code)
        }
      } catch {
        // Non-JSON admission failures still retain their HTTP status and ID.
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
    signal.throwIfAborted()
    throw new ChatGPTResponsesError(
      `ChatGPT Responses API request failed (${response.status})`,
      response.status,
      code,
      requestId,
    )
  }
  // The endpoint sometimes streams valid SSE with no Content-Type at all, so
  // only an explicit non-SSE type is rejected; a non-SSE body without one still
  // fails in the parser ("ended without response.completed").
  const contentType = response.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim()
    .toLowerCase()
  if (contentType && contentType !== 'text/event-stream') {
    await response.body?.cancel()
    throw new ChatGPTResponsesError('ChatGPT returned a non-streaming response')
  }
  return parseResponsesSSE(response, signal)
}
