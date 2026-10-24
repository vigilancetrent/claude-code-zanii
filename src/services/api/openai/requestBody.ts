/**
 * Pure utility functions for building OpenAI request bodies and detecting
 * thinking mode. Extracted from index.ts so tests can import them without
 * triggering heavy module side-effects (OpenAI client, stream adapter, etc.).
 */
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.mjs'
import { isEnvTruthy, isEnvDefinedFalsy } from '../../../utils/envUtils.js'

/**
 * Detect whether thinking mode should be enabled for this model.
 *
 * Enabled when:
 * 1. OPENAI_ENABLE_THINKING=1 is set (explicit enable), OR
 * 2. Model name contains "deepseek" or "mimo" (auto-detect, case-insensitive)
 *
 * Disabled when:
 * - OPENAI_ENABLE_THINKING=0/false/no/off is explicitly set (overrides model detection)
 *
 * @param model - The resolved OpenAI model name
 */
export function isOpenAIThinkingEnabled(
  model: string,
  effortLevel?: string,
): boolean {
  // Explicit disable takes priority (overrides model auto-detect)
  if (isEnvDefinedFalsy(process.env.OPENAI_ENABLE_THINKING)) return false
  // Explicit enable
  if (isEnvTruthy(process.env.OPENAI_ENABLE_THINKING)) return true
  // /effort low on a thinking-capable model = skip the thinking phase
  if (effortLevel === 'low') return false
  // Auto-detect from model name (DeepSeek and MiMo models support thinking mode).
  // Grok is intentionally excluded — Grok reasoning models reason automatically
  // and do NOT require thinking/enable_thinking request body parameters.
  const modelLower = model.toLowerCase()
  return modelLower.includes('deepseek') || modelLower.includes('mimo')
}

/**
 * Resolve max output tokens for the OpenAI-compatible path.
 *
 * Override priority:
 * 1. maxOutputTokensOverride (programmatic, from query pipeline)
 * 2. OPENAI_MAX_TOKENS env var (OpenAI-specific, useful for local models
 *    with small context windows, e.g. RTX 3060 12GB running 65536-token models)
 * 3. CLAUDE_CODE_MAX_OUTPUT_TOKENS env var (generic override)
 * 4. upperLimit default (64000)
 */
export function resolveOpenAIMaxTokens(
  upperLimit: number,
  maxOutputTokensOverride?: number,
): number {
  return (
    maxOutputTokensOverride ??
    (process.env.OPENAI_MAX_TOKENS
      ? parseInt(process.env.OPENAI_MAX_TOKENS, 10) || undefined
      : undefined) ??
    (process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
      ? parseInt(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, 10) || undefined
      : undefined) ??
    upperLimit
  )
}

/**
 * Map our effort level onto Chat Completions `reasoning_effort`. Only the
 * three classic values are universally accepted; xhigh/max fold into high.
 */
export type ChatReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
const EFFORT_RANK: ChatReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]

export function toChatCompletionsReasoningEffort(
  effort: unknown,
): ChatReasoningEffort | undefined {
  if (effort === 'low' || effort === 'medium' || effort === 'high')
    return effort
  if (effort === 'xhigh' || effort === 'max') return 'high'
  return undefined
}

/**
 * Every OpenAI-compatible server has its own idea of valid reasoning_effort
 * values (chat templates differ per model: a Qwen template may accept only
 * xhigh/medium/low). When a request is rejected for the effort value we
 * remember, per model, what to send instead — parsed from the server's own
 * "Supported types are …" text when present, otherwise nothing — and retry.
 */
const effortOverrideByModel = new Map<string, ChatReasoningEffort | null>()

export function applyEffortOverride(
  model: string,
  effort: ChatReasoningEffort | undefined,
): ChatReasoningEffort | undefined {
  if (effort === undefined) return undefined
  if (!effortOverrideByModel.has(model)) return effort
  return effortOverrideByModel.get(model) ?? undefined
}

export function isReasoningEffortRejection(message: string): boolean {
  return /reasoning[ _-]?effort/i.test(message)
}

/** Levels the server named in its error, in our rank order; empty if none. */
export function parseSupportedEfforts(message: string): ChatReasoningEffort[] {
  const m = /supported (?:types|values)?\s*(?:are|:)?\s*([^.\n]+)/i.exec(
    message,
  )
  const haystack = (m?.[1] ?? '').toLowerCase()
  return EFFORT_RANK.filter(level =>
    new RegExp(`\\b${level}\\b`).test(haystack),
  )
}

/** Closest supported level to what was asked, preferring the higher one on a tie. */
export function nearestEffort(
  wanted: ChatReasoningEffort,
  supported: ChatReasoningEffort[],
): ChatReasoningEffort | undefined {
  if (supported.length === 0) return undefined
  const want = EFFORT_RANK.indexOf(wanted)
  return [...supported].sort(
    (a, b) =>
      Math.abs(EFFORT_RANK.indexOf(a) - want) -
        Math.abs(EFFORT_RANK.indexOf(b) - want) ||
      EFFORT_RANK.indexOf(b) - EFFORT_RANK.indexOf(a),
  )[0]
}

/**
 * Record what to send for this model after a rejection. Returns the new
 * value (undefined = stop sending the field) so the caller can log it.
 */
export function rememberEffortRejection(
  model: string,
  wanted: ChatReasoningEffort,
  message: string,
): ChatReasoningEffort | undefined {
  const next = nearestEffort(wanted, parseSupportedEfforts(message))
  effortOverrideByModel.set(model, next ?? null)
  return next
}

export function _resetEffortOverridesForTests(): void {
  effortOverrideByModel.clear()
}

/**
 * Build the request body for OpenAI chat.completions.create().
 * Extracted for testability — the thinking mode params are injected here.
 *
 * Three thinking-mode formats are sent simultaneously; each endpoint uses the
 * format it recognizes and ignores the others:
 * - Official DeepSeek API:    `thinking: { type: 'enabled' }`
 * - Self-hosted DeepSeek:     `enable_thinking: true` + `chat_template_kwargs: { thinking: true }`
 * - MiMo (Xiaomi):            `chat_template_kwargs: { enable_thinking: true }`
 * OpenAI SDK passes unknown keys through to the HTTP body.
 */
export function buildOpenAIRequestBody(params: {
  model: string
  messages: any[]
  tools: any[]
  toolChoice: any
  enableThinking: boolean
  maxTokens: number
  temperatureOverride?: number
  /** Session-scoped routing key for official OpenAI requests. */
  promptCacheKey?: string
  /** Omitted when undefined so plain endpoints never see the key. */
  reasoningEffort?: ChatReasoningEffort
}): ChatCompletionCreateParamsStreaming & {
  thinking?: { type: string }
  enable_thinking?: boolean
  chat_template_kwargs?: { thinking: boolean; enable_thinking: boolean }
  /** OpenAI prompt-cache routing key (not always in SDK types yet). */
  prompt_cache_key?: string
} {
  const {
    model,
    messages,
    tools,
    toolChoice,
    enableThinking,
    maxTokens,
    temperatureOverride,
    promptCacheKey,
    reasoningEffort,
  } = params
  return {
    model,
    messages,
    max_tokens: maxTokens,
    ...(promptCacheKey && { prompt_cache_key: promptCacheKey }),
    ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
    ...(tools.length > 0 && {
      tools,
      ...(toolChoice && { tool_choice: toolChoice }),
    }),
    stream: true,
    stream_options: { include_usage: true },
    // Enable chain-of-thought output for DeepSeek and MiMo models.
    // When active, temperature/top_p/presence_penalty/frequency_penalty are ignored.
    ...(enableThinking && {
      // Official DeepSeek API format
      thinking: { type: 'enabled' },
      // Self-hosted DeepSeek-V3.2 format
      enable_thinking: true,
      // Both DeepSeek self-hosted and MiMo formats in chat_template_kwargs
      chat_template_kwargs: { thinking: true, enable_thinking: true },
    }),
    // Only send temperature when thinking mode is off (DeepSeek ignores it anyway,
    // but other providers may respect it)
    ...(!enableThinking &&
      temperatureOverride !== undefined && {
        temperature: temperatureOverride,
      }),
  }
}
