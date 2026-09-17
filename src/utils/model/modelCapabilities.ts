import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import isEqual from 'lodash-es/isEqual.js'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { z } from 'zod/v4'
import { OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getAnthropicClient } from '../../services/api/client.js'
import { isClaudeAISubscriber } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import { lazySchema } from '../lazySchema.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { jsonStringify } from '../slowOperations.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'

// .strip() — don't persist internal-only fields (mycro_deployments etc.) to disk
const ModelCapabilitySchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      max_input_tokens: z.number().optional(),
      max_tokens: z.number().optional(),
    })
    .strip(),
)

const CacheFileSchema = lazySchema(() =>
  z.object({
    models: z.array(ModelCapabilitySchema()),
    timestamp: z.number(),
  }),
)

export type ModelCapability = z.infer<ReturnType<typeof ModelCapabilitySchema>>

function getCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'cache')
}

function getCachePath(): string {
  return join(getCacheDir(), 'model-capabilities.json')
}

function isModelCapabilitiesEligible(): boolean {
  // Upstream gates this to ant-only, but the /v1/models API is available
  // to all firstParty users (API key and OAuth). Enabling for everyone
  // lets model capabilities (max_input_tokens, max_tokens) be fetched
  // dynamically instead of relying on hardcoded values in context.ts.
  const provider = getAPIProvider()
  // OpenAI-compatible servers (vLLM, llama.cpp, LM Studio, Ollama, …)
  // advertise their context length on /v1/models too — without it the
  // agent assumes 200K and only compacts after the server has already 413'd.
  if (provider === 'openai') return true
  if (provider !== 'firstParty') return false
  if (!isFirstPartyAnthropicBaseUrl()) return false
  return true
}

/**
 * Pull a context length out of an OpenAI-compatible /v1/models entry.
 * vLLM: max_model_len · llama.cpp: meta.n_ctx (falls back to n_ctx_train) ·
 * LM Studio / OpenRouter-style: context_length / context_window.
 */
export function contextLengthFromModelEntry(
  entry: Record<string, unknown>,
): number | undefined {
  const meta = (entry.meta ?? {}) as Record<string, unknown>
  const candidates = [
    entry.max_model_len,
    meta.n_ctx,
    meta.n_ctx_train,
    entry.context_length,
    entry.context_window,
    (entry.top_provider as Record<string, unknown> | undefined)?.context_length,
  ]
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1024) return n
  }
  return undefined
}

async function fetchOpenAICompatibleCapabilities(): Promise<ModelCapability[]> {
  const baseUrl = (
    process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
  const apiKey = process.env.OPENAI_API_KEY
  const res = await fetch(`${baseUrl}/models`, {
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  const body = (await res.json()) as { data?: Array<Record<string, unknown>> }
  const out: ModelCapability[] = []
  for (const entry of body.data ?? []) {
    if (typeof entry.id !== 'string') continue
    const max_input_tokens = contextLengthFromModelEntry(entry)
    if (max_input_tokens === undefined) continue
    out.push({ id: entry.id, max_input_tokens })
  }
  return out
}

// Longest-id-first so substring match prefers most specific; secondary key for stable isEqual
function sortForMatching(models: ModelCapability[]): ModelCapability[] {
  return [...models].sort(
    (a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id),
  )
}

// Keyed on cache path so tests that set CLAUDE_CONFIG_DIR get a fresh read
const loadCache = memoize(
  (path: string): ModelCapability[] | null => {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- memoized; called from sync getContextWindowForModel
      const raw = readFileSync(path, 'utf-8')
      const parsed = CacheFileSchema().safeParse(safeParseJSON(raw, false))
      return parsed.success ? parsed.data.models : null
    } catch {
      return null
    }
  },
  path => path,
)

export function getModelCapability(model: string): ModelCapability | undefined {
  if (!isModelCapabilitiesEligible()) return undefined
  const cached = loadCache(getCachePath())
  if (!cached || cached.length === 0) return undefined
  const m = model.toLowerCase()
  const exact = cached.find(c => c.id.toLowerCase() === m)
  if (exact) return exact
  return cached.find(c => m.includes(c.id.toLowerCase()))
}

export async function refreshModelCapabilities(): Promise<void> {
  if (!isModelCapabilitiesEligible()) return
  if (isEssentialTrafficOnly()) return

  try {
    const parsed: ModelCapability[] = []
    if (getAPIProvider() === 'openai') {
      parsed.push(...(await fetchOpenAICompatibleCapabilities()))
    } else {
      const anthropic = await getAnthropicClient({ maxRetries: 1 })
      const betas = isClaudeAISubscriber() ? [OAUTH_BETA_HEADER] : undefined
      for await (const entry of anthropic.models.list({ betas })) {
        const result = ModelCapabilitySchema().safeParse(entry)
        if (result.success) parsed.push(result.data)
      }
    }
    if (parsed.length === 0) return

    const path = getCachePath()
    const models = sortForMatching(parsed)
    if (isEqual(loadCache(path), models)) {
      logForDebugging('[modelCapabilities] cache unchanged, skipping write')
      return
    }

    await mkdir(getCacheDir(), { recursive: true })
    await writeFile(path, jsonStringify({ models, timestamp: Date.now() }), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    loadCache.cache.delete(path)
    logForDebugging(`[modelCapabilities] cached ${models.length} models`)
  } catch (error) {
    logForDebugging(
      `[modelCapabilities] fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}
