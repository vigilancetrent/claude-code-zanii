import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import stripAnsi from 'strip-ansi'
import { authMock } from '../../tests/mocks/auth'
import { debugMock } from '../../tests/mocks/debug'
import { logMock } from '../../tests/mocks/log'

const directory = await mkdtemp(join(tmpdir(), 'ccz-chatgpt-cost-'))
if (!resolve(directory).startsWith(resolve(tmpdir(), 'ccz-chatgpt-cost-')))
  throw new Error('Invalid cost fixture directory')
const envKeys = [
  'CLAUDE_CONFIG_DIR',
  'OPENAI_AUTH_MODE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
]
const originalEnv = Object.fromEntries(
  envKeys.map(key => [key, process.env[key]]),
)
process.env.CLAUDE_CONFIG_DIR = directory
let providerSetting: string | undefined = 'openai'
mock.module('bun:bundle', () => ({ feature: () => false }))
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/api/client.ts', () => ({
  getAnthropicClient: () => {
    throw new Error('Unexpected Anthropic client access during cost rendering')
  },
}))
mock.module('src/utils/auth.ts', () => ({
  ...authMock(),
  getSubscriptionType: () => null,
  isTeamPremiumSubscriber: () => false,
  getAnthropicApiKey: () => null,
  hasProfileScope: () => false,
  handleOAuth401Error: async () => false,
  refreshAndGetAwsCredentials: async () => undefined,
}))
mock.module('src/utils/settings/settings.ts', () => ({
  getInitialSettings: () => ({ modelType: providerSetting }),
  getSettings_DEPRECATED: () => ({ modelType: providerSetting }),
  getSettingsForSource: () => ({}),
  updateSettingsForSource: () => ({}),
}))
mock.module('src/utils/config.ts', () => ({
  getGlobalConfig: () => ({}),
  saveGlobalConfig: () => {},
  getCurrentProjectConfig: () => ({}),
  saveCurrentProjectConfig: () => {},
  checkHasTrustDialogAccepted: () => false,
}))
mock.module('src/services/analytics/growthbook.ts', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, fallback: unknown) =>
    fallback,
  getFeatureFlag: () => false,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
}))

const { formatTotalCost } = await import('../cost-tracker.js')
const { getContextWindowForModel, getModelMaxOutputTokens } = await import(
  '../utils/context.js'
)
const { setChatGPTModelCatalog } = await import(
  '../utils/model/chatgptModels.js'
)
const {
  getTotalCostUSD,
  getTotalInputTokens,
  getTotalOutputTokens,
  resetCostState,
  setCostStateForRestore,
} = await import('../bootstrap/state.js')

function restoreUsage(costUSD = 0): void {
  setCostStateForRestore({
    totalCostUSD: costUSD,
    totalAPIDuration: 1000,
    totalAPIDurationWithoutRetries: 1000,
    totalToolDuration: 200,
    totalLinesAdded: 2,
    totalLinesRemoved: 1,
    lastDuration: 2000,
    modelUsage: {
      'subscription-model': {
        inputTokens: 321,
        outputTokens: 77,
        cacheReadInputTokens: 19,
        cacheCreationInputTokens: 3,
        webSearchRequests: 0,
        costUSD: 0,
        contextWindow: 100_000,
        maxOutputTokens: 10_000,
      },
      ...(costUSD > 0
        ? {
            'prior-api-model': {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD,
              contextWindow: 100_000,
              maxOutputTokens: 10_000,
            },
          }
        : {}),
    },
  })
}

beforeEach(() => {
  for (const key of envKeys)
    if (key !== 'CLAUDE_CONFIG_DIR') delete process.env[key]
  process.env.OPENAI_AUTH_MODE = 'chatgpt'
  providerSetting = 'openai'
  resetCostState()
})

afterAll(async () => {
  setChatGPTModelCatalog([])
  resetCostState()
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(directory, { recursive: true, force: true })
})

describe('actual cost tracker with ChatGPT subscription billing', () => {
  test('subscription context uses discovered limits even with a legacy 1M suffix', () => {
    setChatGPTModelCatalog([
      {
        value: 'subscription-model',
        label: 'Test model',
        description: 'Fixture',
        contextWindow: 100_000,
        maxOutputTokens: 8_000,
      },
    ])
    expect(getContextWindowForModel('subscription-model[1m]')).toBe(100_000)
    expect(getModelMaxOutputTokens('subscription-model')).toEqual({
      default: 8_000,
      upperLimit: 8_000,
    })
    setChatGPTModelCatalog([])
  })
  test('labels plan requests without inventing per-model API prices and retains measured token counts', () => {
    restoreUsage()
    const output = stripAnsi(formatTotalCost())
    expect(output).toContain('Billing:               ChatGPT plan')
    expect(output).toContain('subscription usage excluded from API costs')
    expect(output).toContain('Recorded API cost:')
    expect(output).toContain(
      '321 input, 77 output, 19 cache read, 3 cache write',
    )
    expect(output).toContain('(ChatGPT plan usage; no API charge recorded)')
    expect(output).not.toContain('($0.0000)')
    expect(getTotalCostUSD()).toBe(0)
    expect(getTotalInputTokens()).toBe(321)
    expect(getTotalOutputTokens()).toBe(77)
  })

  test('retains earlier API charges when the current connection uses a subscription', () => {
    restoreUsage(1.25)
    const output = stripAnsi(formatTotalCost())
    expect(output).toMatch(/Recorded API cost:\s+\$1\.25/)
    expect(output).toContain('prior-api-model:')
    expect(output).toContain('($1.25)')
    expect(output).toContain('subscription-model:')
    expect(output).toContain('(ChatGPT plan usage; no API charge recorded)')
    expect(getTotalCostUSD()).toBe(1.25)
    expect(getTotalInputTokens()).toBe(421)
  })

  test.each([
    'api-key',
    'compatible',
  ])('keeps conventional cost output in explicit %s mode', mode => {
    process.env.OPENAI_AUTH_MODE = mode
    restoreUsage(1.25)
    const output = stripAnsi(formatTotalCost())
    expect(output).toMatch(/Total cost:\s+\$1\.25/)
    expect(output).not.toContain('ChatGPT plan')
    expect(output).toContain('($0.0000)')
  })

  test('does not relabel another provider when an old ChatGPT auth-mode environment value remains', () => {
    providerSetting = undefined
    restoreUsage(1.25)
    const output = stripAnsi(formatTotalCost())
    expect(output).toContain('Total cost:')
    expect(output).not.toContain('ChatGPT plan')
  })
})
