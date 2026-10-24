import { expect, mock, spyOn, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { debugMock } from '../mocks/debug'
mock.module('src/utils/debug.ts', debugMock)
import {
  asSystemPrompt,
  type AssistantMessage,
  type ChatGPTResponsesState,
} from '@ant/model-provider'
import {
  getChatGPTAuthStatus,
  getValidChatGPTAuth,
  removeChatGPTAuth,
  startChatGPTLogin,
  type ChatGPTLogin,
} from '../../src/services/api/openai/chatgptAuth.js'
import * as storage from '../../src/services/api/openai/chatgptStorage.js'
import {
  clearChatGPTModelCatalog,
  fetchChatGPTModelCatalog,
} from '../../src/services/api/openai/chatgptModels.js'
import {
  adaptResponsesStreamToAnthropic,
  buildResponsesRequest,
  createChatGPTResponsesStream,
  messagesWithResponsesState,
} from '../../src/services/api/openai/responsesAdapter.js'

test('app-owned sign-in, model discovery, tool continuation, transcript reload and logout share one subscription account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ccz-chatgpt-integration-'))
  if (
    !resolve(directory).startsWith(
      resolve(tmpdir(), 'ccz-chatgpt-integration-'),
    )
  ) {
    throw new Error(
      'Refusing to use a directory outside the integration fixture root',
    )
  }
  const originalConfig = process.env.CLAUDE_CONFIG_DIR
  const originalBaseURL = process.env.OPENAI_BASE_URL
  const originalKey = process.env.OPENAI_API_KEY
  const originalCodex = process.env.CODEX_HOME
  const originalFetch = globalThis.fetch
  const issuer = 'https://auth.openai.com'
  const clientId = 'oaiapp_integration_test'
  const model = 'integration-model'
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let nonce = ''
  let flow: ChatGPTLogin | undefined
  let protection: ReturnType<typeof spyOn> | undefined
  let unprotection: ReturnType<typeof spyOn> | undefined
  const responseRequests: Record<string, any>[] = []
  const upstreamURLs: string[] = []
  const nativeOutput = [
    {
      type: 'reasoning',
      id: 'rs_integration',
      summary: [],
      encrypted_content: 'opaque-synthetic-reasoning',
    },
    {
      type: 'function_call',
      id: 'fc_integration',
      call_id: 'call_integration',
      namespace: 'local_tools',
      name: 'read_fixture',
      arguments: '{}',
      status: 'completed',
    },
  ]
  try {
    process.env.CLAUDE_CONFIG_DIR = directory
    process.env.CODEX_HOME = join(directory, 'unused-codex')
    process.env.OPENAI_BASE_URL =
      'https://must-not-receive-subscription-token.invalid'
    process.env.OPENAI_API_KEY = 'synthetic-paid-key-must-not-be-used'
    // The OAuth/API boundaries are synthetic; only Windows DPAPI needs an OS mock.
    if (process.platform === 'win32') {
      protection = spyOn(
        storage,
        'protectChatGPTCredentials',
      ).mockImplementation(
        async value =>
          `unit-protected:${Buffer.from(value).toString('base64')}`,
      )
      unprotection = spyOn(
        storage,
        'unprotectChatGPTCredentials',
      ).mockImplementation(async value =>
        value.startsWith('unit-protected:')
          ? Buffer.from(
              value.slice('unit-protected:'.length),
              'base64',
            ).toString('utf8')
          : value,
      )
    }
    clearChatGPTModelCatalog()
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url =
        input instanceof Request ? new URL(input.url) : new URL(String(input))
      upstreamURLs.push(url.href)
      if (url.href === `${issuer}/.well-known/openid-configuration`)
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/api/accounts/authorize`,
          token_endpoint: `${issuer}/api/accounts/oauth/token`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
          revocation_endpoint: `${issuer}/api/accounts/oauth/revoke`,
        })
      if (url.href === `${issuer}/.well-known/jwks.json`)
        return Response.json({
          keys: [
            {
              ...key.publicKey.export({ format: 'jwk' }),
              kid: 'integration-key',
              alg: 'RS256',
              use: 'sig',
            },
          ],
        })
      if (url.href === `${issuer}/api/accounts/oauth/token`) {
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', kid: 'integration-key' }),
        ).toString('base64url')
        const payload = Buffer.from(
          JSON.stringify({
            iss: issuer,
            aud: clientId,
            sub: 'integration-subject',
            exp: Math.floor(Date.now() / 1000) + 3600,
            nonce,
          }),
        ).toString('base64url')
        const signature = sign(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          key.privateKey,
        ).toString('base64url')
        expect(new URLSearchParams(String(init?.body)).get('client_id')).toBe(
          clientId,
        )
        return Response.json({
          id_token: `${header}.${payload}.${signature}`,
          access_token: 'synthetic-plan-access',
          refresh_token: 'synthetic-plan-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope:
            'openid profile offline_access resource.invoke chatgpt.tokens.use.direct',
        })
      }
      if (url.href === `${issuer}/api/accounts/oauth/revoke`)
        return new Response(null, { status: 200 })
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer synthetic-plan-access',
      )
      if (url.href === 'https://api.openai.com/v1/models')
        return Response.json({
          models: [
            {
              slug: model,
              display_name: 'Integration model',
              visibility: 'list',
              context_window: 100_000,
            },
          ],
        })
      if (url.href === 'https://api.openai.com/v1/responses') {
        const request = JSON.parse(String(init?.body)) as Record<string, any>
        responseRequests.push(request)
        expect(request.model).toBe(model)
        expect(request.store).toBe(false)
        expect(request.stream).toBe(true)
        expect(request.tools[0].type).toBe('namespace')
        const output =
          responseRequests.length === 1
            ? nativeOutput
            : [
                {
                  type: 'message',
                  id: 'msg_final',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text: 'The fixture contains alpha.',
                    },
                  ],
                },
              ]
        return new Response(
          `data: ${JSON.stringify({ type: 'response.completed', response: { id: `resp_integration_${responseRequests.length}`, status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5 } } })}\r\n\r\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      throw new Error(
        'An unexpected host or billing path received a subscription request',
      )
    }) as typeof fetch

    flow = await startChatGPTLogin()
    const authorization = new URL(flow.authorizationUrl)
    nonce = authorization.searchParams.get('nonce')!
    const redirect = new URL(authorization.searchParams.get('redirect_uri')!)
    redirect.search = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      code: 'integration-code',
      client_id: clientId,
      iss: issuer,
    }).toString()
    const login = flow.complete()
    expect((await originalFetch(redirect)).status).toBe(200)
    expect((await login).planUsageEnabled).toBe(true)
    const auth = await getValidChatGPTAuth()
    expect((await fetchChatGPTModelCatalog(auth))[0]!.value).toBe(model)
    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_fixture',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]
    const initial = {
      model,
      tools,
      toolChoice: undefined,
      promptCacheKey: 'integration-session',
      accountKey: auth.accountKey,
    }
    const request = buildResponsesRequest({
      ...initial,
      messages: [
        { role: 'developer', content: 'Use the approved local fixture tool.' },
        { role: 'user', content: 'Read the fixture.' },
      ],
    })
    const source = await createChatGPTResponsesStream({
      request,
      signal: new AbortController().signal,
    })
    let state: ChatGPTResponsesState | undefined
    const firstEvents = []
    for await (const event of adaptResponsesStreamToAnthropic(source, model, {
      accountKey: auth.accountKey,
      onCompleted(value) {
        state = value
      },
    }))
      firstEvents.push(event)
    expect(
      firstEvents.filter(
        event =>
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use',
      ),
    ).toHaveLength(1)
    expect(firstEvents.at(-1)?.type).toBe('message_stop')
    expect(state?.output).toEqual(nativeOutput)

    // Persist the normal nested message metadata before constructing the continuation.
    const assistant = {
      type: 'assistant',
      uuid: '00000000-0000-4000-8000-000000000001',
      message: {
        role: 'assistant',
        id: 'message_integration',
        content: [
          {
            type: 'tool_use',
            id: 'call_integration',
            name: 'read_fixture',
            input: {},
          },
        ],
        chatgptResponses: state,
      },
    } as AssistantMessage
    const transcript = join(directory, 'transcript.json')
    await writeFile(transcript, JSON.stringify([assistant]))
    const restored = JSON.parse(
      await readFile(transcript, 'utf8'),
    ) as AssistantMessage[]
    await writeFile(join(directory, 'fixture.txt'), 'alpha')
    const localToolResult = await readFile(
      join(directory, 'fixture.txt'),
      'utf8',
    )
    const history = messagesWithResponsesState(
      restored,
      asSystemPrompt(['Use the approved local fixture tool.']),
    )
    const nextRequest = buildResponsesRequest({
      ...initial,
      messages: [
        ...history,
        {
          role: 'tool',
          tool_call_id: 'call_integration',
          content: localToolResult,
        },
      ],
    })
    expect(nextRequest.input).toEqual([
      ...nativeOutput,
      {
        type: 'function_call_output',
        call_id: 'call_integration',
        output: 'alpha',
      },
    ])
    const nextSource = await createChatGPTResponsesStream({
      request: nextRequest,
      signal: new AbortController().signal,
    })
    const finalEvents = []
    for await (const event of adaptResponsesStreamToAnthropic(
      nextSource,
      model,
      { accountKey: auth.accountKey },
    ))
      finalEvents.push(event)
    expect(
      finalEvents
        .filter(
          event =>
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta',
        )
        .map(event =>
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
            ? event.delta.text
            : '',
        )
        .join(''),
    ).toBe('The fixture contains alpha.')
    expect(finalEvents.at(-1)?.type).toBe('message_stop')
    expect(responseRequests).toHaveLength(2)
    expect(JSON.stringify(responseRequests)).not.toContain(auth.accountKey)
    expect(JSON.stringify(responseRequests)).not.toContain(auth.accessToken)
    expect(await removeChatGPTAuth()).toEqual({})
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'not_logged_in',
    })
    await expect(
      createChatGPTResponsesStream({
        request: nextRequest,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'not_logged_in' })
    expect(responseRequests).toHaveLength(2)
    expect(
      upstreamURLs.every(
        url =>
          url.startsWith(issuer + '/') ||
          url.startsWith('https://api.openai.com/v1/'),
      ),
    ).toBe(true)
  } finally {
    flow?.cancel()
    globalThis.fetch = originalFetch
    protection?.mockRestore()
    unprotection?.mockRestore()
    clearChatGPTModelCatalog()
    for (const [name, value] of Object.entries({
      CLAUDE_CONFIG_DIR: originalConfig,
      OPENAI_BASE_URL: originalBaseURL,
      OPENAI_API_KEY: originalKey,
      CODEX_HOME: originalCodex,
    })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
