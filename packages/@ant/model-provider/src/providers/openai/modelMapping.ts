/**
 * Default mapping from Anthropic model names to OpenAI model names.
 * Used only when ANTHROPIC_DEFAULT_*_MODEL env vars are not set.
 */
const DEFAULT_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'gpt-4o',
  'claude-sonnet-4-5-20250929': 'gpt-4o',
  'claude-sonnet-4-6': 'gpt-4o',
  'claude-opus-4-20250514': 'o3',
  'claude-opus-4-1-20250805': 'o3',
  'claude-opus-4-5-20251101': 'o3',
  'claude-opus-4-6': 'o3',
  'claude-haiku-4-5-20251001': 'gpt-4o-mini',
  'claude-3-5-haiku-20241022': 'gpt-4o-mini',
  'claude-3-7-sonnet-20250219': 'gpt-4o',
  'claude-3-5-sonnet-20241022': 'gpt-4o',
}

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

/**
 * Resolve the OpenAI model name for a given Anthropic model.
 *
 * Priority:
 * 1. OPENAI_MODEL env var (override all)
 * 2. OPENAI_DEFAULT_{FAMILY}_MODEL env var (e.g. OPENAI_DEFAULT_SONNET_MODEL)
 * 3. ANTHROPIC_DEFAULT_{FAMILY}_MODEL env var (backward compatibility)
 * 4. DEFAULT_MODEL_MAP lookup
 * 5. Pass through original model name
 */
export function resolveOpenAIModel(anthropicModel: string): string {
  // Strip the [1m] context-window flag — it's a client-side marker consumed
  // by getContextWindowForModel(), never a valid provider model id.
  const cleanModel = anthropicModel.replace(/\[1m\]$/i, '')
  const family = getModelFamily(cleanModel)

  // An explicit server model id (picked in /model from the server's list, or
  // passed with --model) is not a Claude name: send it as-is. OPENAI_MODEL is
  // the *default* for Claude-style names, not an override of the user's pick.
  const isClaudeStyle =
    family !== null ||
    /claude/i.test(cleanModel) ||
    cleanModel in DEFAULT_MODEL_MAP
  if (!isClaudeStyle) return cleanModel

  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL.replace(/\[1m\]$/i, '')
  }

  if (family) {
    const openaiEnvVar = `OPENAI_DEFAULT_${family.toUpperCase()}_MODEL`
    const openaiOverride = process.env[openaiEnvVar]
    if (openaiOverride) return openaiOverride

    const anthropicEnvVar = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
    const anthropicOverride = process.env[anthropicEnvVar]
    if (anthropicOverride) return anthropicOverride
  }

  return DEFAULT_MODEL_MAP[cleanModel] ?? cleanModel
}
