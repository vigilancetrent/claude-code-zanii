import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  getChatGPTAuthStatus,
  getValidChatGPTAuth,
  removeChatGPTAuth,
  startChatGPTLogin,
  type ChatGPTLogin,
} from '../chatgptAuth.js'
import {
  protectChatGPTCredentials,
  unprotectChatGPTCredentials,
} from '../chatgptStorage.js'
import * as credentialStorage from '../chatgptStorage.js'

const ISSUER = 'https://auth.openai.com'
const CLIENT = 'oaiapp_unit_test'
const SCOPE =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const originalFetch = globalThis.fetch
const originalConfig = process.env.CLAUDE_CONFIG_DIR
const originalCodex = process.env.CODEX_HOME
let directory: string
let flows: ChatGPTLogin[] = []
let key: { publicKey: KeyObject; privateKey: KeyObject }
let signingKey: { publicKey: KeyObject; privateKey: KeyObject }
let issuedClaims: Record<string, unknown>
let tokenPatch: Record<string, unknown>
let tokenError: { status: number; error: string } | undefined
let revokeStatus: number
let nonce: string
let tokenCalls: URLSearchParams[]
let beforeToken: (() => Promise<void>) | undefined
let protectSpy: ReturnType<typeof spyOn> | undefined
let unprotectSpy: ReturnType<typeof spyOn> | undefined

function signedIdentity(claims: Record<string, unknown> = {}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'unit-key' }),
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      sub: 'test-subject',
      aud: CLIENT,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce,
      email: 'tést@example.invalid',
      ...claims,
    }),
  ).toString('base64url')
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), signingKey.privateKey).toString('base64url')}`
}

function tokenResponse(): Record<string, unknown> {
  return {
    id_token: signedIdentity(issuedClaims),
    access_token: `access-${tokenCalls.length}`,
    refresh_token: `refresh-${tokenCalls.length}`,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: SCOPE,
    ...tokenPatch,
  }
}

async function storedState(): Promise<Record<string, any>> {
  return JSON.parse(
    await unprotectChatGPTCredentials(
      await readFile(join(directory, 'openai-chatgpt-auth.json'), 'utf8'),
    ),
  )
}

async function seedState(
  patch: Record<string, unknown> = {},
  tokensPatch: Record<string, unknown> = {},
): Promise<void> {
  const data = {
    version: 1,
    hostId: `urn:uuid:${randomUUID()}`,
    generation: randomUUID(),
    clientId: CLIENT,
    subject: 'test-subject',
    email: 'tést@example.invalid',
    tokens: {
      idToken: signedIdentity(),
      accessToken: 'seed-access',
      refreshToken: 'seed-refresh',
      scopes: SCOPE.split(' '),
      expiresAt: Date.now() + 3600_000,
      ...tokensPatch,
    },
    ...patch,
  }
  await writeFile(
    join(directory, 'openai-chatgpt-auth.json'),
    await protectChatGPTCredentials(JSON.stringify(data)),
    { mode: 0o600 },
  )
}

async function begin(): Promise<{ flow: ChatGPTLogin; url: URL }> {
  const flow = await startChatGPTLogin()
  flows.push(flow)
  const url = new URL(flow.authorizationUrl)
  nonce = url.searchParams.get('nonce')!
  return { flow, url }
}

async function callback(
  url: URL,
  patch: Record<string, string | null | undefined> = {},
): Promise<Response> {
  const redirect = new URL(url.searchParams.get('redirect_uri')!)
  redirect.search = new URLSearchParams({
    code: 'unit-code',
    state: url.searchParams.get('state')!,
    client_id: CLIENT,
    iss: ISSUER,
  }).toString()
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) redirect.searchParams.delete(name)
    else if (value !== undefined) redirect.searchParams.set(name, value)
  }
  return originalFetch(redirect, { redirect: 'error' })
}

async function signIn() {
  const { flow, url } = await begin()
  const completion = flow.complete()
  await callback(url)
  return { result: await completion, url }
}

beforeAll(() => {
  key = generateKeyPairSync('rsa', { modulusLength: 2048 })
})

beforeEach(async () => {
  // Managed Windows runs cannot spawn DPAPI; only that OS boundary is mocked.
  if (process.platform === 'win32') {
    protectSpy = spyOn(
      credentialStorage,
      'protectChatGPTCredentials',
    ).mockImplementation(
      async json => `unit-protected:${Buffer.from(json).toString('base64')}`,
    )
    unprotectSpy = spyOn(
      credentialStorage,
      'unprotectChatGPTCredentials',
    ).mockImplementation(async stored =>
      stored.startsWith('unit-protected:')
        ? Buffer.from(
            stored.slice('unit-protected:'.length),
            'base64',
          ).toString('utf8')
        : stored,
    )
  }
  directory = await mkdtemp(join(tmpdir(), 'ccz-chatgpt-auth-'))
  process.env.CLAUDE_CONFIG_DIR = directory
  process.env.CODEX_HOME = join(directory, 'fake-codex')
  flows = []
  signingKey = key
  issuedClaims = {}
  tokenPatch = {}
  tokenError = undefined
  revokeStatus = 200
  nonce = 'seed-nonce'
  tokenCalls = []
  beforeToken = undefined
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      input instanceof Request ? new URL(input.url) : new URL(String(input))
    if (url.origin !== ISSUER)
      throw new Error('Unexpected external request in auth unit test')
    if (url.pathname === '/.well-known/openid-configuration')
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
        token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
      })
    if (url.pathname === '/.well-known/jwks.json')
      return Response.json({
        keys: [
          {
            ...key.publicKey.export({ format: 'jwk' }),
            kid: 'unit-key',
            alg: 'RS256',
            use: 'sig',
          },
        ],
      })
    if (url.pathname === '/api/accounts/oauth/revoke')
      return new Response(null, { status: revokeStatus })
    if (url.pathname === '/api/accounts/oauth/token') {
      tokenCalls.push(new URLSearchParams(String(init?.body)))
      await beforeToken?.()
      if (tokenError)
        return Response.json(
          {
            error: tokenError.error,
            error_description: 'secret-response-must-not-leak',
          },
          { status: tokenError.status },
        )
      return Response.json(tokenResponse())
    }
    throw new Error('Unexpected authentication URL')
  }) as typeof fetch
})

afterEach(async () => {
  for (const flow of flows) flow.cancel()
  globalThis.fetch = originalFetch
  protectSpy?.mockRestore()
  unprotectSpy?.mockRestore()
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfig
  if (originalCodex === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = originalCodex
  if (!resolve(directory).startsWith(resolve(tmpdir(), 'ccz-chatgpt-auth-')))
    throw new Error(
      'Refusing to remove a directory outside the test fixture root',
    )
  await rm(directory, { recursive: true, force: true })
})

describe('ChatGPT app-owned authentication', () => {
  test('registers this installation and completes signed PKCE login without an API key', async () => {
    const { result, url } = await signIn()
    expect(url.origin).toBe(ISSUER)
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(url.searchParams.get('agent_name_hint')).toBe('Zanii')
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct')
    expect(new URL(url.searchParams.get('redirect_uri')!).hostname).toBe(
      '127.0.0.1',
    )
    expect(tokenCalls[0]!.get('client_id')).toBe(CLIENT)
    expect(tokenCalls[0]!.get('resource')).toBe('https://api.openai.com/v1')
    expect(tokenCalls[0]!.get('redirect_uri')).toBe(
      url.searchParams.get('redirect_uri')!,
    )
    expect(
      createHash('sha256')
        .update(tokenCalls[0]!.get('code_verifier')!)
        .digest('base64url'),
    ).toBe(url.searchParams.get('code_challenge')!)
    expect(result.planUsageEnabled).toBe(true)
    expect(result.accountKey).toMatch(/^[a-f0-9]{64}$/)
    expect(await getValidChatGPTAuth()).toEqual({
      accessToken: result.accessToken,
      accountId: 'test-subject',
      accountKey: result.accountKey,
    })
    expect(await getChatGPTAuthStatus()).toMatchObject({
      loggedIn: true,
      planUsageEnabled: true,
      email: 'tést@example.invalid',
    })
    const raw = await readFile(
      join(directory, 'openai-chatgpt-auth.json'),
      'utf8',
    )
    if (process.platform === 'win32') {
      expect(raw).toStartWith('unit-protected:')
      expect(raw).not.toContain(result.accessToken)
    }
    expect((await storedState()).tokens.refreshToken).toBe(result.refreshToken)
  }, 30_000)

  test('keeps a verified identity without enabling inference when plan permission was declined', async () => {
    tokenPatch.scope = 'openid profile email'
    const { result } = await signIn()
    expect(result.planUsageEnabled).toBe(false)
    expect(await getChatGPTAuthStatus()).toMatchObject({
      loggedIn: true,
      planUsageEnabled: false,
    })
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'plan_usage_disabled',
    })
    expect(tokenCalls).toHaveLength(1)
  }, 30_000)

  test('rejects a wrong callback state without consuming the valid attempt, including multibyte input', async () => {
    const { flow, url } = await begin()
    const completion = flow.complete()
    const invalid = await callback(url, {
      state: 'é'.repeat(url.searchParams.get('state')!.length),
    })
    expect(invalid.status).toBe(400)
    expect(tokenCalls).toHaveLength(0)
    expect((await callback(url)).status).toBe(200)
    expect((await completion).planUsageEnabled).toBe(true)
  }, 30_000)

  test.each([
    { client_id: null },
    { error: 'access_denied' },
    { iss: 'https://attacker.invalid' },
  ])('rejects incomplete or declined registration callbacks: %j', async patch => {
    const { flow, url } = await begin()
    const completion = flow.complete()
    expect((await callback(url, patch)).status).toBe(400)
    await expect(completion).rejects.toMatchObject({ code: 'invalid_callback' })
    expect(tokenCalls).toHaveLength(0)
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
  }, 30_000)

  test.each([
    { nonce: 'wrong-nonce' },
    { aud: 'different-client' },
    { iss: 'https://attacker.invalid' },
    { exp: 1 },
    { nbf: 9_999_999_999 },
    { aud: [CLIENT, 'other-client'], azp: 'other-client' },
  ])('rejects invalid signed identity claims without saving tokens: %j', async claims => {
    issuedClaims = claims
    await expect(signIn()).rejects.toMatchObject({ code: 'invalid_identity' })
    const saved = await storedState()
    expect(saved.clientId).toBe(CLIENT)
    expect(saved.tokens).toBeUndefined()
  }, 30_000)

  test('rejects an identity signed by an unknown key', async () => {
    signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    await expect(signIn()).rejects.toMatchObject({ code: 'invalid_identity' })
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
  }, 30_000)

  test('reuses the host and issued client on reconnect without exposing token hints in the URL', async () => {
    const first = await signIn()
    const { flow, url } = await begin()
    expect(url.searchParams.get('client_id')).toBe(CLIENT)
    expect(url.searchParams.get('ext_agent_host_id')).toBe(
      first.url.searchParams.get('ext_agent_host_id'),
    )
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
    expect(url.searchParams.has('id_token_hint')).toBe(false)
    const completion = flow.complete()
    await callback(url, { client_id: null })
    expect((await completion).accountKey).toBe(first.result.accountKey)
  }, 30_000)

  test('rejects reconnecting the selected registration under a different identity', async () => {
    await seedState()
    issuedClaims.sub = 'different-subject'
    await expect(signIn()).rejects.toMatchObject({ code: 'invalid_identity' })
    expect((await storedState()).tokens.accessToken).toBe('seed-access')
  }, 30_000)

  test('serializes concurrent refreshes, retains omitted scopes, and stores the rotating token together', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    tokenPatch.scope = undefined
    const results = await Promise.all(
      Array.from({ length: 8 }, () => getValidChatGPTAuth()),
    )
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0]!.get('grant_type')).toBe('refresh_token')
    expect(tokenCalls[0]!.get('scope')).toBeNull()
    expect(results.every(value => value.accessToken === 'access-1')).toBe(true)
    expect((await storedState()).tokens).toMatchObject({
      refreshToken: 'refresh-1',
      scopes: SCOPE.split(' '),
    })
  }, 60_000)

  test('keeps credentials on temporary refresh failures and sanitizes diagnostic bodies', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    tokenError = { status: 503, error: 'temporarily_unavailable' }
    let failure: unknown
    try {
      await getValidChatGPTAuth()
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: 'temporarily_unavailable',
      status: 503,
    })
    expect(String(failure)).not.toContain('secret-response')
    expect((await storedState()).tokens.refreshToken).toBe('seed-refresh')
  }, 30_000)

  test('clears unusable refresh credentials while retaining the registration and host', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    const before = await storedState()
    tokenError = { status: 400, error: 'invalid_grant' }
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'invalid_grant',
    })
    const after = await storedState()
    expect(after.tokens).toBeUndefined()
    expect(after.clientId).toBe(before.clientId)
    expect(after.hostId).toBe(before.hostId)
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'not_logged_in',
    })
  }, 30_000)

  test('rejects a changed refresh identity and preserves the existing token set', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    issuedClaims.sub = 'other-subject'
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'invalid_identity',
    })
    expect((await storedState()).tokens.accessToken).toBe('seed-access')
  }, 30_000)

  test('signs out locally and remotely without importing Codex credentials again', async () => {
    await seedState()
    await mkdir(process.env.CODEX_HOME!, { recursive: true })
    await writeFile(
      join(process.env.CODEX_HOME!, 'auth.json'),
      JSON.stringify({
        tokens: {
          id_token: 'codex-id',
          access_token: 'codex-access',
          refresh_token: 'codex-refresh',
        },
      }),
    )
    expect(await removeChatGPTAuth()).toEqual({})
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
    expect((await storedState()).clientId).toBe(CLIENT)
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'not_logged_in',
    })
    expect(tokenCalls).toHaveLength(0)
  }, 30_000)

  test('reports unconfirmed remote revocation while still clearing all local tokens', async () => {
    await seedState()
    revokeStatus = 503
    expect((await removeChatGPTAuth()).warning).toContain(
      'Remote revocation was not confirmed',
    )
    expect((await storedState()).tokens).toBeUndefined()
  }, 30_000)

  test('logout wins over a pending refresh without resurrecting the token set', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    let releaseToken!: () => void
    const gate = new Promise<void>(resolve => {
      releaseToken = resolve
    })
    let entered!: () => void
    const pending = new Promise<void>(resolve => {
      entered = resolve
    })
    beforeToken = async () => {
      entered()
      await gate
    }
    const refresh = getValidChatGPTAuth()
    await pending
    const logout = removeChatGPTAuth()
    releaseToken()
    await refresh
    await logout
    expect((await storedState()).tokens).toBeUndefined()
  }, 30_000)

  test('rejects a login completed after logout invalidated its generation', async () => {
    const { flow, url } = await begin()
    await removeChatGPTAuth()
    const completion = flow.complete()
    await callback(url)
    await expect(completion).rejects.toMatchObject({ code: 'stale_login' })
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
    expect(tokenCalls).toHaveLength(0)
  }, 30_000)

  test('cancels the loopback listener and rejects completion without network login', async () => {
    const { flow } = await begin()
    const completion = flow.complete()
    flow.cancel()
    await expect(completion).rejects.toMatchObject({ code: 'cancelled' })
    expect(tokenCalls).toHaveLength(0)
  }, 30_000)

  test('never refreshes legacy app or Codex credentials', async () => {
    await writeFile(
      join(directory, 'openai-chatgpt-auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: 'legacy-id',
          access_token: 'legacy-access',
          refresh_token: 'legacy-refresh',
        },
      }),
    )
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'not_logged_in',
    })
    const { flow, url } = await begin()
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    flow.cancel()
    expect(tokenCalls).toHaveLength(0)
  }, 30_000)

  test('recovers unreadable app credentials through explicit logout without hiding the revocation gap', async () => {
    await writeFile(join(directory, 'openai-chatgpt-auth.json'), '{corrupt')
    await expect(getChatGPTAuthStatus()).rejects.toMatchObject({
      code: 'storage_error',
    })
    expect((await removeChatGPTAuth()).warning).toContain(
      'Remote revocation was not confirmed',
    )
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
    const { flow, url } = await begin()
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    flow.cancel()
  }, 30_000)

  test('clears inactive legacy credentials on explicit logout', async () => {
    await writeFile(
      join(directory, 'openai-chatgpt-auth.json'),
      JSON.stringify({ tokens: { access_token: 'legacy-only' } }),
    )
    expect(await removeChatGPTAuth()).toEqual({})
    await expect(
      readFile(join(directory, 'openai-chatgpt-auth.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  test('cancels a queued auth request promptly without letting later requests bypass an active refresh', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    let releaseToken!: () => void
    const gate = new Promise<void>(resolve => {
      releaseToken = resolve
    })
    let entered!: () => void
    const active = new Promise<void>(resolve => {
      entered = resolve
    })
    beforeToken = async () => {
      entered()
      await gate
    }
    const first = getValidChatGPTAuth()
    await active
    const controller = new AbortController()
    const queued = getValidChatGPTAuth(controller.signal)
    controller.abort()
    let next: Promise<unknown>
    try {
      await expect(queued).rejects.toMatchObject({ code: 'cancelled' })
      next = getValidChatGPTAuth()
      expect(tokenCalls).toHaveLength(1)
    } finally {
      releaseToken()
      await first
    }
    await next
    expect(tokenCalls).toHaveLength(1)
  }, 30_000)

  test('does not refresh before the provider earliest-refresh time', async () => {
    await seedState(
      {},
      {
        expiresAt: Date.now() + 20_000,
        earliestRefreshAt: Date.now() + 10_000,
      },
    )
    expect((await getValidChatGPTAuth()).accessToken).toBe('seed-access')
    expect(tokenCalls).toHaveLength(0)
  }, 30_000)

  test('disables inference if refreshed scopes remove plan use', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    tokenPatch.scope = 'openid profile email'
    await expect(getValidChatGPTAuth()).rejects.toMatchObject({
      code: 'plan_usage_disabled',
    })
    expect((await getChatGPTAuthStatus()).planUsageEnabled).toBe(false)
  }, 30_000)

  test('requests consent again only when an existing identity has no plan-use permission', async () => {
    await seedState({}, { scopes: ['openid', 'profile', 'email'] })
    const { flow, url } = await begin()
    expect(url.searchParams.get('prompt')).toBe('consent')
    flow.cancel()
  }, 30_000)

  test('rejects ambiguous duplicate authorization codes', async () => {
    const { flow, url } = await begin()
    const redirect = new URL(url.searchParams.get('redirect_uri')!)
    redirect.search = new URLSearchParams({
      state: url.searchParams.get('state')!,
      code: 'first',
      client_id: CLIENT,
    }).toString()
    redirect.searchParams.append('code', 'second')
    const completion = flow.complete()
    expect((await originalFetch(redirect)).status).toBe(400)
    await expect(completion).rejects.toMatchObject({ code: 'invalid_callback' })
    expect(tokenCalls).toHaveLength(0)
  }, 30_000)

  test('rejects wrong callback methods and paths without consuming authorization', async () => {
    const { flow, url } = await begin()
    const redirect = new URL(url.searchParams.get('redirect_uri')!)
    expect(
      (await originalFetch(redirect, { method: 'POST', body: 'ignored' }))
        .status,
    ).toBe(404)
    redirect.pathname = '/wrong'
    expect((await originalFetch(redirect)).status).toBe(404)
    const completion = flow.complete()
    await callback(url)
    expect((await completion).planUsageEnabled).toBe(true)
  }, 30_000)

  test('rejects unsigned and malformed ID tokens before accepting identity', async () => {
    tokenPatch.id_token = `${Buffer.from('{"alg":"none","kid":"unit-key"}').toString('base64url')}.${Buffer.from('{"sub":"forged"}').toString('base64url')}.fake`
    await expect(signIn()).rejects.toMatchObject({ code: 'invalid_identity' })
    expect((await getChatGPTAuthStatus()).loggedIn).toBe(false)
  }, 30_000)

  test('does not echo arbitrary token endpoint codes or diagnostic fields', async () => {
    await seedState({}, { expiresAt: Date.now() + 20_000 })
    tokenError = { status: 400, error: 'synthetic_secret_lowercase_value' }
    let failure: unknown
    try {
      await getValidChatGPTAuth()
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'token_error', status: 400 })
    expect(String(failure)).not.toContain('synthetic_secret_lowercase_value')
    expect(String(failure)).not.toContain('secret-response')
  }, 30_000)

  test.if(process.platform === 'win32')(
    'rejects unprotected versioned Windows credentials rather than silently treating them as DPAPI',
    async () => {
      unprotectSpy?.mockRestore()
      await expect(
        unprotectChatGPTCredentials('{"version":1}'),
      ).rejects.toThrow('must be protected with DPAPI')
    },
  )
})
