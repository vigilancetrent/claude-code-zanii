import { getGlobalConfig } from '../config.js'
export type ChatGPTCodexModelOption = {
  value: string
  label: string
  description: string
  contextWindow?: number
  maxOutputTokens?: number
}

let discoveredModels: ChatGPTCodexModelOption[] = []
// False until the catalog has been set this run or read back from disk.
let catalogLoaded = false
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'

export function setChatGPTModelCatalog(
  models: ChatGPTCodexModelOption[],
): void {
  discoveredModels = models
  // An empty catalog (logout, account change) falls back to the saved copy,
  // which those paths delete first.
  catalogLoaded = models.length > 0
}

/**
 * The account catalog. Before the first fetch of a run it is the copy saved
 * by the last successful fetch, so the context window is right from startup
 * instead of falling back to the 200K default. The saved copy is removed on
 * logout and account change, so it always belongs to the current login.
 */
export function getChatGPTModelCatalog(): ChatGPTCodexModelOption[] {
  if (!catalogLoaded && isChatGPTAuthMode()) {
    try {
      const saved = getGlobalConfig().chatgptModelCatalog
      // Stop looking only once a saved copy is found. A call made before the
      // config is readable gets defaults (or throws), and must not block the
      // read that follows. getGlobalConfig is cached, so retrying is cheap.
      if (Array.isArray(saved)) {
        catalogLoaded = true
        discoveredModels = saved.filter(
          option =>
            typeof option?.value === 'string' &&
            typeof option.label === 'string',
        )
      }
    } catch {
      // Config not readable yet: keep the fallbacks and try again next call.
    }
  }
  return discoveredModels
}

/** Compatibility defaults used before the account catalog has loaded. */
export const CHATGPT_CODEX_DEFAULT_MODEL = 'gpt-5.6-sol'
export const CHATGPT_CODEX_BALANCED_MODEL = 'gpt-5.6-terra'
/** Fast/small default for lighter tasks. */
export const CHATGPT_CODEX_FAST_MODEL = 'gpt-5.6-luna'

export const CHATGPT_CODEX_MODELS_BY_TIER = {
  opus: CHATGPT_CODEX_DEFAULT_MODEL,
  sonnet: CHATGPT_CODEX_BALANCED_MODEL,
  haiku: CHATGPT_CODEX_FAST_MODEL,
} as const

export type ChatGPTCodexModelTier = keyof typeof CHATGPT_CODEX_MODELS_BY_TIER

/** Resolve one CCB capability tier without coupling the policy to settings. */
export function resolveChatGPTCodexModelForTier(params: {
  tier: ChatGPTCodexModelTier
  isChatGPTAuth: boolean
  tierOverride?: string
  taskOverride?: string
}): string | undefined {
  return (
    params.taskOverride ??
    params.tierOverride ??
    (params.isChatGPTAuth
      ? (getChatGPTModelCatalog()[0]?.value ??
        CHATGPT_CODEX_MODELS_BY_TIER[params.tier])
      : undefined)
  )
}

/**
 * Compatibility budgeting estimate when the account catalog omits limits.
 * This estimate does not describe subscription entitlement or remaining quota.
 */
export const CHATGPT_OAUTH_CONTEXT_WINDOW = 272_000

/**
 * GPT-5.6 family context window on the OpenAI API model card (API key path).
 * Long-context pricing applies above 272k input tokens.
 */
export const CHATGPT_API_CONTEXT_WINDOW = 1_050_000

/** @deprecated Use CHATGPT_OAUTH_CONTEXT_WINDOW or CHATGPT_API_CONTEXT_WINDOW. */
export const CHATGPT_CODEX_CONTEXT_WINDOW = CHATGPT_OAUTH_CONTEXT_WINDOW

/** Official GPT-5.6 family max output tokens (OpenAI model card). */
export const CHATGPT_CODEX_MAX_OUTPUT_TOKENS = 128_000

/**
 * ChatGPT OAuth / Codex model picker options.
 * Newest GPT-5.6 family first; previous generation models retained for
 * users still on those ids.
 */
export const CHATGPT_CODEX_MODEL_OPTIONS: ChatGPTCodexModelOption[] = [
  {
    value: 'gpt-5.6-sol',
    label: 'gpt-5.6-sol',
    description:
      'Frontier model for complex coding, research, and real-world work',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'gpt-5.6-terra',
    description: 'Strong model for everyday coding',
  },
  {
    value: 'gpt-5.6-luna',
    label: 'gpt-5.6-luna',
    description:
      'Small, fast, and cost-efficient model for simpler coding tasks',
  },
  {
    value: 'gpt-5.5',
    label: 'GPT-5.5',
    description:
      'Frontier model for complex coding, research, and real-world work',
  },
  {
    value: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Strong model for everyday coding',
  },
  {
    value: 'gpt-5.4-mini',
    label: 'GPT-5.4-Mini',
    description:
      'Small, fast, and cost-efficient model for simpler coding tasks',
  },
  {
    value: 'gpt-5.3-codex',
    label: 'GPT-5.3-Codex',
    description: 'Coding-optimized model',
  },
  {
    value: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3-Codex-Spark',
    description: 'Ultra-fast coding model',
  },
  {
    value: 'gpt-5.2',
    label: 'GPT-5.2',
    description: 'Optimized for professional work and long-running agents',
  },
]

export function isChatGPTAuthMode(): boolean {
  return process.env.OPENAI_AUTH_MODE === 'chatgpt'
}

function normalizeChatGPTModelId(model: string): string {
  return model.toLowerCase().replace(/\[1m\]$/i, '')
}

/**
 * Whether this is a GPT-5.6 family model id (Sol/Terra/Luna or bare `gpt-5.6`).
 */
export function isGpt56FamilyModel(model: string): boolean {
  const normalized = normalizeChatGPTModelId(model)
  return normalized === 'gpt-5.6' || normalized.startsWith('gpt-5.6-')
}

export function isChatGPTCodexReasoningModel(model: string): boolean {
  const normalized = normalizeChatGPTModelId(model)
  return (
    isGpt56FamilyModel(model) ||
    CHATGPT_CODEX_MODEL_OPTIONS.some(
      option => option.value.toLowerCase() === normalized,
    )
  )
}

/**
 * Account metadata or compatibility estimates for local budgeting only.
 * These values are not sent as request fields or used to infer plan access.
 */
export function getChatGPTModelContextWindow(
  model: string,
): number | undefined {
  const accountModel = isChatGPTAuthMode()
    ? getChatGPTModelCatalog().find(option => option.value === model)
    : undefined
  if (accountModel) {
    // shortcut: missing catalog limits use the existing estimate; replace it when the service supplies model-specific limits.
    return accountModel.contextWindow ?? CHATGPT_OAUTH_CONTEXT_WINDOW
  }
  if (!isGpt56FamilyModel(model)) {
    return undefined
  }
  return isChatGPTAuthMode()
    ? CHATGPT_OAUTH_CONTEXT_WINDOW
    : CHATGPT_API_CONTEXT_WINDOW
}
