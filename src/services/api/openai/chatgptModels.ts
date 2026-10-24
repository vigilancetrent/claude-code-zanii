import { z } from 'zod/v4'
import {
  CHATGPT_CODEX_MODELS_BY_TIER,
  getChatGPTModelCatalog,
  setChatGPTModelCatalog,
  type ChatGPTCodexModelOption,
} from 'src/utils/model/chatgptModels.js'
import type { ChatGPTAuth } from './chatgptAuth.js'

const CATALOG_TTL_MS = 5 * 60 * 1000
const CATALOG_MAX_BYTES = 1024 * 1024
const catalogSchema = z.object({
  models: z
    .array(
      z.object({
        slug: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[\w./:-]+$/),
        display_name: z
          .string()
          .min(1)
          .max(200)
          .refine(value => !/\p{Cc}/u.test(value)),
        visibility: z.string().max(40),
        context_window: z.number().int().positive().max(10_000_000).optional(),
        max_output_tokens: z
          .number()
          .int()
          .positive()
          .max(10_000_000)
          .optional(),
      }),
    )
    .max(2000),
})

let cachedAccount: string | undefined
let expiresAt = 0
let generation = 0

export function clearChatGPTModelCatalog(): void {
  cachedAccount = undefined
  expiresAt = 0
  generation += 1
  setChatGPTModelCatalog([])
}

export async function fetchChatGPTModelCatalog(
  auth: ChatGPTAuth,
  signal?: AbortSignal,
  fetchOverride?: typeof fetch,
): Promise<ChatGPTCodexModelOption[]> {
  signal?.throwIfAborted()
  if (cachedAccount === auth.accountKey && expiresAt > Date.now()) {
    return getChatGPTModelCatalog()
  }
  // Clear before fetching so a failed account switch cannot retain another catalog.
  clearChatGPTModelCatalog()
  const requestGeneration = generation
  const timeout = AbortSignal.timeout(10_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await (fetchOverride ?? globalThis.fetch)(
    'https://api.openai.com/v1/models',
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: 'application/json',
      },
      signal: requestSignal,
      redirect: 'error',
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `ChatGPT model discovery failed (HTTP ${response.status}). Reconnect with /login or check your ChatGPT plan access.`,
    )
  }
  if (!response.body) throw new Error('ChatGPT model catalog was empty.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      requestSignal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > CATALOG_MAX_BYTES)
        throw new Error('ChatGPT model catalog exceeded the size limit.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  let parsed: z.infer<typeof catalogSchema>
  try {
    parsed = catalogSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
    )
  } catch {
    throw new Error('ChatGPT returned an invalid model catalog.')
  }
  const seen = new Set<string>()
  const options = parsed.models
    .filter(model => {
      if (model.visibility !== 'list' || seen.has(model.slug)) return false
      seen.add(model.slug)
      return true
    })
    .map(model => ({
      value: model.slug,
      label: model.display_name,
      description:
        'Available in the connected ChatGPT account catalog; request access is checked by OpenAI',
      contextWindow: model.context_window,
      maxOutputTokens: model.max_output_tokens,
    }))
  if (options.length === 0)
    throw new Error(
      'No ChatGPT models are available for this account. Check plan permissions or reconnect with /login.',
    )
  requestSignal.throwIfAborted()
  if (generation === requestGeneration) {
    cachedAccount = auth.accountKey
    expiresAt = Date.now() + CATALOG_TTL_MS
    setChatGPTModelCatalog(options)
  }
  return options
}

export function resolveChatGPTModel(
  model: string,
  options: ChatGPTCodexModelOption[] = getChatGPTModelCatalog(),
): string {
  model = model.replace(/\[1m\]$/i, '')
  if (options.some(option => option.value === model)) return model
  const isDefault =
    ['default', 'opus', 'sonnet', 'haiku'].includes(model) ||
    model.startsWith('claude-') ||
    Object.values(CHATGPT_CODEX_MODELS_BY_TIER).some(value => value === model)
  if (isDefault && options[0]) return options[0].value
  return model
}
