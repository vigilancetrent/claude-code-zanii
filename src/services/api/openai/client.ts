import OpenAI from 'openai'
import { openaiAdapter } from 'src/services/providerUsage/adapters/openai.js'
import { updateProviderBuckets } from 'src/services/providerUsage/store.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'

/**
 * Environment variables:
 *
 * OPENAI_API_KEY: Required. API key for the OpenAI-compatible endpoint.
 * OPENAI_BASE_URL: Recommended. Base URL for the endpoint (e.g. http://localhost:11434/v1).
 * OPENAI_ORG_ID: Optional. Organization ID.
 * OPENAI_PROJECT_ID: Optional. Project ID.
 */

let cachedClient: OpenAI | null = null

/**
 * Wrap a fetch so that every response's rate-limit headers are fed into the
 * provider usage store. Errors in parsing must never break the request.
 *
 * The cast to `typeof fetch` is safe: OpenAI SDK only calls the function form,
 * not the static `preconnect` method that Bun/Node's `fetch` type declares.
 */
function wrapFetchForUsage(base: typeof fetch): typeof fetch {
  const wrapped = async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const res = await base(...args)
    try {
      updateProviderBuckets('openai', openaiAdapter.parseHeaders(res.headers))
    } catch {
      // Ignore — usage tracking must not affect the request path.
    }
    return coerceStreamErrorBody(res, args[1])
  }
  return wrapped as unknown as typeof fetch
}

/**
 * Some gateways/proxies forward a backend 4xx as HTTP 200 with the JSON error
 * as the body — often still labelled text/event-stream. The SDK's SSE parser
 * then sees zero events and the caller gets an empty response with no error.
 * Peek at the first bytes: a body starting with `{` is a JSON error, not SSE;
 * re-wrap it as a non-2xx Response so the SDK throws a normal APIError.
 * Real SSE bodies are replayed untouched.
 */
export async function coerceStreamErrorBody(
  res: Response,
  init: RequestInit | undefined,
): Promise<Response> {
  const isStreamingRequest =
    typeof init?.body === 'string' && init.body.includes('"stream":true')
  if (!res.ok || !isStreamingRequest || !res.body) return res

  const reader = res.body.getReader()
  const first = await reader.read()
  const decoder = new TextDecoder()
  const head = first.value ? decoder.decode(first.value, { stream: true }) : ''
  if (!head.trimStart().startsWith('{')) {
    // Genuine SSE (or empty): hand back a stream that replays what we read.
    const replay = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.value) controller.enqueue(first.value)
        if (first.done) controller.close()
      },
      async pull(controller) {
        const { value, done } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      },
      cancel() {
        void reader.cancel()
      },
    })
    return new Response(replay, { status: res.status, headers: res.headers })
  }

  let text = head
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  let status = 502
  try {
    const err = (
      JSON.parse(text) as { error?: { code?: unknown; status?: unknown } }
    ).error
    if (!err) {
      // JSON but not an error envelope — let the SDK deal with it.
      return new Response(text, { status: res.status, headers: res.headers })
    }
    const code = Number(err.code ?? err.status)
    if (Number.isInteger(code) && code >= 400 && code <= 599) status = code
  } catch {
    // Not JSON after all; pass through with the original status.
    return new Response(text, { status: res.status, headers: res.headers })
  }
  const headers = new Headers(res.headers)
  headers.set('content-type', 'application/json')
  return new Response(text, { status, headers })
}

export function getOpenAIClient(options?: {
  maxRetries?: number
  fetchOverride?: typeof fetch
  source?: string
}): OpenAI {
  if (cachedClient) return cachedClient

  const apiKey = process.env.OPENAI_API_KEY || ''
  const baseURL = process.env.OPENAI_BASE_URL

  const baseFetch = options?.fetchOverride ?? (globalThis.fetch as typeof fetch)
  const wrappedFetch = wrapFetchForUsage(baseFetch)

  const client = new OpenAI({
    apiKey,
    ...(baseURL && { baseURL }),
    maxRetries: options?.maxRetries ?? 0,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    ...(process.env.OPENAI_ORG_ID && {
      organization: process.env.OPENAI_ORG_ID,
    }),
    ...(process.env.OPENAI_PROJECT_ID && {
      project: process.env.OPENAI_PROJECT_ID,
    }),
    fetchOptions: getProxyFetchOptions({ forAnthropicAPI: false }),
    fetch: wrappedFetch,
  })

  if (!options?.fetchOverride) {
    cachedClient = client
  }

  return client
}

/** Clear the cached client (useful when env vars change). */
export function clearOpenAIClientCache(): void {
  cachedClient = null
}
