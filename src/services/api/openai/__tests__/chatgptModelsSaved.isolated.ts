// Isolated: these tests need the real config module, which other test files
// in the shared process replace with a mock.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getChatGPTModelCatalog,
  getChatGPTModelContextWindow,
  resolveChatGPTCodexModelForTier,
} from 'src/utils/model/chatgptModels.js'
import {
  clearChatGPTModelCatalog,
  fetchChatGPTModelCatalog,
  resolveChatGPTModel,
} from '../chatgptModels.js'
import type { ChatGPTAuth } from '../chatgptAuth.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'

const originalFetch = globalThis.fetch
const originalAuthMode = process.env.OPENAI_AUTH_MODE
const auth: ChatGPTAuth = {
  accessToken: 'synthetic-model-token',
  accountKey: 'account-a',
}
const catalog = {
  models: [
    { slug: 'private-model', display_name: 'Hidden', visibility: 'hidden' },
    {
      slug: 'test-model',
      display_name: 'Account model',
      visibility: 'list',
      context_window: 100_000,
    },
    { slug: 'test-fast', display_name: 'Fast model', visibility: 'list' },
    { slug: 'test-model', display_name: 'Duplicate', visibility: 'list' },
  ],
}

beforeEach(() => clearChatGPTModelCatalog())
afterEach(() => {
  globalThis.fetch = originalFetch
  clearChatGPTModelCatalog()
  if (originalAuthMode === undefined) delete process.env.OPENAI_AUTH_MODE
  else process.env.OPENAI_AUTH_MODE = originalAuthMode
})

describe('saved ChatGPT model catalog', () => {
  test('keeps the catalog and its limits when a refresh for the same account fails', async () => {
    process.env.OPENAI_AUTH_MODE = 'chatgpt'
    let requests = 0
    globalThis.fetch = (async () => {
      requests += 1
      return requests === 1
        ? Response.json(catalog)
        : new Response('upstream down', { status: 503 })
    }) as unknown as typeof fetch
    await fetchChatGPTModelCatalog(auth)
    expect(getGlobalConfig().chatgptModelCatalog?.[0]?.value).toBe('test-model')
    const realNow = Date.now
    Date.now = () => realNow() + 6 * 60 * 1000 // past the catalog TTL
    try {
      await expect(fetchChatGPTModelCatalog(auth)).rejects.toThrow('HTTP 503')
    } finally {
      Date.now = realNow
    }
    expect(requests).toBe(2)
    expect(getChatGPTModelContextWindow('test-model')).toBe(100_000)
    clearChatGPTModelCatalog()
    expect(getGlobalConfig().chatgptModelCatalog).toBeUndefined()
  })

  test('uses the saved catalog at startup, before any fetch', () => {
    process.env.OPENAI_AUTH_MODE = 'chatgpt'
    saveGlobalConfig(current => ({
      ...current,
      chatgptModelCatalog: [
        {
          value: 'saved-model',
          label: 'Saved',
          description: 'saved',
          contextWindow: 500_000,
        },
      ],
    }))
    expect(getChatGPTModelContextWindow('saved-model')).toBe(500_000)
    // Signed out of ChatGPT: the saved copy is not consulted.
    delete process.env.OPENAI_AUTH_MODE
    expect(getChatGPTModelContextWindow('saved-model')).toBeUndefined()
  })
})
