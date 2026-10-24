import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import type {
  ChatGPTAuthTokens,
  ChatGPTLogin,
} from '../../../services/api/openai/chatgptAuth.js'
import type { ChatGPTLoginOptions } from '../chatgptLogin.js'
import { isChatGPTLoginActive } from 'src/utils/chatgptLoginSignals.js'

class TestAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

const AUTHORIZATION_URL =
  'https://auth.openai.com/api/accounts/authorize?state=synthetic-cli-state'
let settings: Record<string, unknown> = {}
let effectiveOverrides: Record<string, unknown> = {}
let settingsFailure: unknown
let settingsReadFailure: unknown
let configFailure: unknown
let tokens: ChatGPTAuthTokens
let currentConfig: Record<string, unknown>
let observedSignal: AbortSignal | undefined
let stdout = ''
let stderr = ''
let stdoutSpy: ReturnType<typeof spyOn>
let stderrSpy: ReturnType<typeof spyOn>
let previousMode: string | undefined
let previousHostManaged: string | undefined
let previousExitCode: typeof process.exitCode
let intListeners = process.listeners('SIGINT')
let termListeners = process.listeners('SIGTERM')

const cancel = mock(() => {})
const complete = mock(async () => tokens)
const start = mock(async (signal?: AbortSignal): Promise<ChatGPTLogin> => {
  observedSignal = signal
  return { authorizationUrl: AUTHORIZATION_URL, complete, cancel }
})
const catalog = mock(async (_auth?: unknown, _signal?: AbortSignal) => [
  { value: 'available-model' },
])
const clearCatalog = mock(() => {})
const clearClient = mock(() => {})
const browser = mock(async (_url: string) => true)
function persistSettings(_source: string, patch: Record<string, unknown>) {
  if (!settingsFailure) {
    settings = {
      ...settings,
      ...patch,
      env: {
        ...(settings.env as Record<string, unknown> | undefined),
        ...(patch.env as Record<string, unknown> | undefined),
      },
    }
  }
  return { error: settingsFailure }
}
const update = mock(persistSettings)
const saveConfig = mock(
  (updater: (value: Record<string, unknown>) => Record<string, unknown>) => {
    if (configFailure) throw configFailure
    currentConfig = updater(currentConfig)
  },
)
mock.module('src/services/api/openai/chatgptAuth.ts', () => ({
  ChatGPTAuthError: TestAuthError,
  startChatGPTLogin: start,
}))
mock.module('src/services/api/openai/chatgptModels.ts', () => ({
  clearChatGPTModelCatalog: clearCatalog,
  fetchChatGPTModelCatalog: catalog,
}))
mock.module('src/services/api/openai/client.ts', () => ({
  clearOpenAIClientCache: clearClient,
}))
mock.module('src/utils/browser.ts', () => ({ openBrowser: browser }))
mock.module('src/utils/config.ts', () => ({ saveGlobalConfig: saveConfig }))
mock.module('src/utils/settings/settings.ts', () => ({
  getInitialSettings: () => {
    if (settingsReadFailure) throw settingsReadFailure
    return {
      ...settings,
      ...effectiveOverrides,
      env: {
        ...(settings.env as Record<string, unknown> | undefined),
        ...(effectiveOverrides.env as Record<string, unknown> | undefined),
      },
    }
  },
  updateSettingsForSource: update,
}))

const { authLoginChatGPT } = await import('../chatgptLogin.js')

beforeEach(() => {
  previousMode = process.env.OPENAI_AUTH_MODE
  previousHostManaged = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  previousExitCode = process.exitCode
  process.env.OPENAI_AUTH_MODE = 'api-key'
  delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  process.exitCode = undefined
  settings = {}
  effectiveOverrides = {}
  settingsFailure = undefined
  settingsReadFailure = undefined
  configFailure = undefined
  tokens = {
    idToken: 'synthetic-id',
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    accountKey: 'test-account',
    planUsageEnabled: true,
  }
  currentConfig = { unrelatedPreference: 'keep' }
  observedSignal = undefined
  stdout = ''
  stderr = ''
  for (const item of [
    cancel,
    complete,
    start,
    catalog,
    clearCatalog,
    clearClient,
    browser,
    update,
    saveConfig,
  ])
    item.mockClear()
  complete.mockImplementation(async () => tokens)
  start.mockImplementation(async (signal?: AbortSignal) => {
    observedSignal = signal
    return { authorizationUrl: AUTHORIZATION_URL, complete, cancel }
  })
  catalog.mockImplementation(async () => [{ value: 'available-model' }])
  browser.mockImplementation(async () => true)
  update.mockImplementation(persistSettings)
  intListeners = process.listeners('SIGINT')
  termListeners = process.listeners('SIGTERM')
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout += String(chunk)
    return true
  })
  stderrSpy = spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderr += String(chunk)
    return true
  })
})

afterEach(() => {
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
  if (previousMode === undefined) delete process.env.OPENAI_AUTH_MODE
  else process.env.OPENAI_AUTH_MODE = previousMode
  if (previousHostManaged === undefined)
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = previousHostManaged
  process.exitCode = previousExitCode
  expect(process.listeners('SIGINT')).toEqual(intListeners)
  expect(process.listeners('SIGTERM')).toEqual(termListeners)
  expect(isChatGPTLoginActive()).toBe(false)
})

describe('authLoginChatGPT', () => {
  test('activates app-owned subscription access only after consent and model discovery', async () => {
    const order: string[] = []
    start.mockImplementation(async (signal?: AbortSignal) => {
      observedSignal = signal
      order.push('authorization')
      expect(stdout).toContain('Any ChatGPT account can attempt sign-in')
      expect(stdout).toContain('OpenAI determines model access')
      expect(isChatGPTLoginActive()).toBe(true)
      return { authorizationUrl: AUTHORIZATION_URL, complete, cancel }
    })
    catalog.mockImplementation(async () => {
      order.push('models')
      expect(update).not.toHaveBeenCalled()
      expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
      return [{ value: 'available-model' }]
    })
    await authLoginChatGPT({})
    expect(order).toEqual(['authorization', 'models'])
    expect(browser).toHaveBeenCalledWith(AUTHORIZATION_URL)
    expect(stdout).toContain(
      `If it does not open, visit this authorization link:\n${AUTHORIZATION_URL}`,
    )
    expect(stdout).toContain('https://chatgpt.com/settings/usage')
    expect(stdout).toContain('no inference request was made during sign-in')
    expect(catalog).toHaveBeenCalledWith(tokens, observedSignal)
    expect(update).toHaveBeenCalledWith('userSettings', {
      modelType: 'openai',
      env: { OPENAI_AUTH_MODE: 'chatgpt' },
    })
    expect(process.env.OPENAI_AUTH_MODE).toBe('chatgpt')
    expect(currentConfig).toEqual({
      unrelatedPreference: 'keep',
      chatgptPlanUsageNoticeSeen: true,
      hasCompletedOnboarding: true,
    })
    expect(clearClient).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(observedSignal?.aborted).toBe(true)
    expect(process.exitCode).toBe(0)
    expect(stderr).toBe('')
  })

  test.each([
    { console: true },
    { claudeai: true },
    { sso: true },
    { email: 'user@example.invalid' },
    { console: true, claudeai: true },
  ])('rejects conflicting Anthropic flags before authorization: %j', async options => {
    await authLoginChatGPT(options as ChatGPTLoginOptions)
    expect(start).not.toHaveBeenCalled()
    expect(clearCatalog).not.toHaveBeenCalled()
    expect(browser).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(stdout).toBe('')
    expect(stderr).toContain('cannot be combined')
    expect(process.exitCode).toBe(1)
  })

  test.each([
    { forceLoginMethod: 'claudeai' },
    { forceLoginMethod: 'console' },
    { forceLoginOrgUUID: 'managed-org' },
  ])('honors managed Anthropic policy before creating app credentials: %j', async policy => {
    settings = policy
    await authLoginChatGPT({})
    expect(start).not.toHaveBeenCalled()
    expect(clearCatalog).not.toHaveBeenCalled()
    expect(browser).not.toHaveBeenCalled()
    expect(stdout).toBe('')
    expect(stderr).toContain('Managed settings require an Anthropic')
    expect(process.exitCode).toBe(1)
  })

  test('fails closed when managed login settings cannot be read', async () => {
    settingsReadFailure = new Error('synthetic-private-settings-detail')
    await authLoginChatGPT({})
    expect(start).not.toHaveBeenCalled()
    expect(stdout).toBe('')
    expect(stderr).toContain('Login policy settings could not be read')
    expect(stderr).not.toContain('synthetic-private-settings-detail')
    expect(process.exitCode).toBe(1)
  })

  test.each([
    'free',
    'plus',
    'pro',
    'business',
    undefined,
  ])('does not locally restrict account tier %s', async tier => {
    tokens = { ...tokens, plan: tier } as ChatGPTAuthTokens
    await authLoginChatGPT({})
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(0)
  })

  test('retains identity-only consent without activating inference or the provider', async () => {
    tokens.planUsageEnabled = false
    await authLoginChatGPT({})
    expect(catalog).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(stderr).toContain('plan usage was not authorized')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  test('keeps the selected provider when model discovery fails and redacts arbitrary upstream errors', async () => {
    catalog.mockImplementation(async () => {
      throw new Error(`${AUTHORIZATION_URL}&access_token=synthetic-secret`)
    })
    await authLoginChatGPT({})
    expect(update).not.toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(stderr).toContain('model catalog')
    expect(stderr).not.toContain('synthetic-secret')
    expect(stderr).not.toContain(AUTHORIZATION_URL)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  test('does not activate the provider when user settings cannot be saved', async () => {
    settingsFailure = new Error('synthetic-settings-secret')
    await authLoginChatGPT({})
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(saveConfig).not.toHaveBeenCalled()
    expect(clearClient).not.toHaveBeenCalled()
    expect(stderr).toContain('connection could not be read or saved')
    expect(stderr).not.toContain('synthetic-settings-secret')
    expect(process.exitCode).toBe(1)
  })

  test('maps typed storage failures to bounded recovery without printing raw errors', async () => {
    start.mockImplementation(async () => {
      throw new TestAuthError(
        `${AUTHORIZATION_URL}&token=synthetic-private-detail`,
        'storage_error',
      )
    })
    await authLoginChatGPT({})
    expect(stderr).toContain('Cannot read or protect')
    expect(stderr).not.toContain('synthetic-private-detail')
    expect(browser).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  test('handles plain credential-protection failures before opening a browser without leaking details', async () => {
    start.mockImplementation(async () => {
      throw new Error(`${AUTHORIZATION_URL}&private=synthetic-secret`)
    })
    await authLoginChatGPT({})
    expect(stderr).toContain(
      'local credential protection and network availability',
    )
    expect(stderr).not.toContain('synthetic-secret')
    expect(stderr).not.toContain(AUTHORIZATION_URL)
    expect(browser).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  test('does not open a browser or wait for consent after cancellation during setup', async () => {
    start.mockImplementation(async (signal?: AbortSignal) => {
      observedSignal = signal
      const handler = process
        .listeners('SIGINT')
        .find(listener => !intListeners.includes(listener))!
      handler('SIGINT')
      return { authorizationUrl: AUTHORIZATION_URL, complete, cancel }
    })
    await authLoginChatGPT({})
    expect(browser).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(130)
  })

  test.each([
    'SIGINT',
    'SIGTERM',
  ] as const)('cancels browser authorization on %s and cleans listeners', async signal => {
    complete.mockImplementation(async () => {
      const original = signal === 'SIGINT' ? intListeners : termListeners
      const handler = process
        .listeners(signal)
        .find(listener => !original.includes(listener))!
      handler(signal)
      throw new Error('synthetic-cancel-detail')
    })
    await authLoginChatGPT({})
    expect(observedSignal?.aborted).toBe(true)
    expect(update).not.toHaveBeenCalled()
    expect(stderr).toContain('sign-in cancelled')
    expect(stderr).not.toContain('synthetic-cancel-detail')
    expect(cancel).toHaveBeenCalled()
    expect(process.exitCode).toBe(signal === 'SIGINT' ? 130 : 143)
  })

  test('does not save activation after cancellation during model discovery', async () => {
    catalog.mockImplementation(async () => {
      const handler = process
        .listeners('SIGINT')
        .find(listener => !intListeners.includes(listener))!
      handler('SIGINT')
      return [{ value: 'available-model' }]
    })
    await authLoginChatGPT({})
    expect(update).not.toHaveBeenCalled()
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(process.exitCode).toBe(130)
  })

  test('keeps the terminal fallback when the browser cannot open', async () => {
    browser.mockImplementation(async () => {
      throw new Error(AUTHORIZATION_URL)
    })
    await authLoginChatGPT({})
    expect(stdout).toContain(AUTHORIZATION_URL)
    expect(process.exitCode).toBe(0)
    expect(stderr).toBe('')
  })

  test('warns about onboarding preferences without undoing a successfully saved connection', async () => {
    configFailure = new Error('synthetic-config-secret')
    await authLoginChatGPT({})
    expect(process.env.OPENAI_AUTH_MODE).toBe('chatgpt')
    expect(stderr).toContain('onboarding preferences could not be saved')
    expect(stderr).not.toContain('synthetic-config-secret')
    expect(process.exitCode).toBe(0)
  })

  test.each([
    { modelType: 'gemini' },
    { env: { OPENAI_AUTH_MODE: 'api-key' } },
  ])('refuses higher-priority provider overrides without mutating the active environment: %j', async overrides => {
    effectiveOverrides = overrides
    await authLoginChatGPT({})
    expect(update).toHaveBeenCalledTimes(1)
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(clearClient).not.toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
    expect(stderr).toContain('Higher-priority settings override')
    expect(process.exitCode).toBe(1)
  })

  test('rechecks enforced policy after asynchronous authorization and before writing settings', async () => {
    catalog.mockImplementation(async () => {
      effectiveOverrides.forceLoginOrgUUID = 'managed-org'
      return [{ value: 'available-model' }]
    })
    await authLoginChatGPT({})
    expect(update).not.toHaveBeenCalled()
    expect(clearClient).not.toHaveBeenCalled()
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(stderr).toContain(
      'ChatGPT activation is not allowed under that policy',
    )
    expect(process.exitCode).toBe(1)
  })

  test.each([
    '1',
    'true',
    'yes',
    'on',
  ])('honors a host-managed provider before starting browser authorization (%s)', async value => {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = value
    await authLoginChatGPT({})
    expect(start).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(clearCatalog).not.toHaveBeenCalled()
    expect(stdout).toBe('')
    expect(stderr).toContain('The host manages model providers')
    expect(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe(value)
    expect(process.exitCode).toBe(1)
  })

  test('rechecks host provider ownership after consent without modifying the host flag', async () => {
    catalog.mockImplementation(async () => {
      process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
      return [{ value: 'available-model' }]
    })
    await authLoginChatGPT({})
    expect(update).not.toHaveBeenCalled()
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(stderr).toContain('The host manages model providers')
    expect(process.exitCode).toBe(1)
  })

  test('does not treat an explicitly false host-managed flag as a restriction', async () => {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = 'false'
    await authLoginChatGPT({})
    expect(process.exitCode).toBe(0)
  })

  test('verifies effective settings even when a persistence helper reports a successful no-op', async () => {
    update.mockImplementation(() => ({ error: undefined }))
    await authLoginChatGPT({})
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(clearClient).not.toHaveBeenCalled()
    expect(stderr).toContain('Higher-priority settings override')
    expect(process.exitCode).toBe(1)
  })

  test('sanitizes failures rereading effective settings after the user-settings write', async () => {
    update.mockImplementation(() => {
      settingsReadFailure = new Error('synthetic-private-override-details')
      return { error: undefined }
    })
    await authLoginChatGPT({})
    expect(process.env.OPENAI_AUTH_MODE).toBe('api-key')
    expect(clearClient).not.toHaveBeenCalled()
    expect(stderr).toContain('connection could not be read or saved')
    expect(stderr).not.toContain('synthetic-private-override-details')
    expect(process.exitCode).toBe(1)
  })
})
