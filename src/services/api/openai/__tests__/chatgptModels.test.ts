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

describe('ChatGPT account model catalog', () => {
  test('uses only the public authenticated route and preserves visible catalog order', async () => {
    let requests = 0
    globalThis.fetch = (async (
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      requests += 1
      expect(String(url)).toBe('https://api.openai.com/v1/models')
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        `Bearer ${auth.accessToken}`,
      )
      expect(init?.redirect).toBe('error')
      return Response.json(catalog)
    }) as unknown as typeof fetch
    const models = await fetchChatGPTModelCatalog(auth)
    expect(models.map(model => model.value)).toEqual([
      'test-model',
      'test-fast',
    ])
    expect(models[0]?.label).toBe('Account model')
    expect(models[0]?.contextWindow).toBe(100_000)
    process.env.OPENAI_AUTH_MODE = 'chatgpt'
    expect(getChatGPTModelContextWindow('test-model')).toBe(100_000)
    expect(getChatGPTModelContextWindow('claude-sonnet-4-6')).toBeUndefined()
    await fetchChatGPTModelCatalog(auth)
    expect(requests).toBe(1)
    expect(
      resolveChatGPTCodexModelForTier({ tier: 'haiku', isChatGPTAuth: true }),
    ).toBe('test-model')
    expect(resolveChatGPTModel('sonnet', models)).toBe('test-model')
    expect(resolveChatGPTModel('test-model[1m]', models)).toBe('test-model')
    expect(resolveChatGPTModel('explicit-user-model', models)).toBe(
      'explicit-user-model',
    )
  })

  test('clears the previous account catalog if a newly selected account is denied', async () => {
    let requests = 0
    globalThis.fetch = (async () => {
      requests += 1
      return requests === 1
        ? Response.json(catalog)
        : new Response('private upstream diagnostics', { status: 403 })
    }) as unknown as typeof fetch
    await fetchChatGPTModelCatalog(auth)
    await expect(
      fetchChatGPTModelCatalog({ ...auth, accountKey: 'account-b' }),
    ).rejects.toThrow('HTTP 403')
    expect(getChatGPTModelCatalog()).toEqual([])
    expect(requests).toBe(2)
  })

  test.each([
    { data: [{ id: 'api-key-model' }] },
    {
      models: [
        {
          slug: 'bad-display',
          display_name: '\u001b[31mBad',
          visibility: 'list',
        },
      ],
    },
    {
      models: [{ slug: 'bad model', display_name: 'Bad', visibility: 'list' }],
    },
    {
      models: [
        {
          slug: 'bad',
          display_name: 'Bad',
          visibility: 'list',
          context_window: -1,
        },
      ],
    },
  ])('rejects malformed and API-key-format catalogs', async response => {
    globalThis.fetch = (async () =>
      Response.json(response)) as unknown as typeof fetch
    await expect(fetchChatGPTModelCatalog(auth)).rejects.toThrow(
      'invalid model catalog',
    )
  })

  test('does not invent a default when the account exposes no models', async () => {
    globalThis.fetch = (async () =>
      Response.json({ models: [] })) as unknown as typeof fetch
    await expect(fetchChatGPTModelCatalog(auth)).rejects.toThrow(
      'No ChatGPT models',
    )
  })

  test('bounds model responses and cancels oversized streams', async () => {
    let cancelled = false
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1))
          },
          cancel() {
            cancelled = true
          },
        }),
      )) as unknown as typeof fetch
    await expect(fetchChatGPTModelCatalog(auth)).rejects.toThrow('size limit')
    expect(cancelled).toBe(true)
  })

  test('honors cancellation even with a cached catalog', async () => {
    globalThis.fetch = (async () =>
      Response.json(catalog)) as unknown as typeof fetch
    await fetchChatGPTModelCatalog(auth)
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchChatGPTModelCatalog(auth, controller.signal),
    ).rejects.toThrow()
  })

  test('does not let an earlier in-flight account restore a cleared catalog', async () => {
    let release!: (response: Response) => void
    globalThis.fetch = (() =>
      new Promise<Response>(resolve => {
        release = resolve
      })) as unknown as typeof fetch
    const pending = fetchChatGPTModelCatalog(auth)
    clearChatGPTModelCatalog()
    release(Response.json(catalog))
    const ownModels = await pending
    expect(resolveChatGPTModel('default', ownModels)).toBe('test-model')
    expect(getChatGPTModelCatalog()).toEqual([])
  })
})
