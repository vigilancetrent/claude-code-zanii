// Isolated: these tests need the real file lock, which another test file in
// the shared process replaces with a no-op.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getKimiAuthStatus,
  getValidKimiAuth,
  resolveKimiRegion,
  startKimiLogin,
} from '../kimiAuth.js'
import {
  protectChatGPTCredentials,
  unprotectChatGPTCredentials,
} from '../chatgptStorage.js'

let directory: string
let polls = 0
let refreshStatus = 200
const originalFetch = globalThis.fetch
const originalConfig = process.env.CLAUDE_CONFIG_DIR
const originalAuthMode = process.env.OPENAI_AUTH_MODE
const originalBaseURL = process.env.KIMI_CODE_BASE_URL
const originalRegion = process.env.KIMI_REGION
const requests: string[] = []
let verificationURL: string | undefined

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function seed(tokens: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(directory, 'kimi-auth.json'),
    await protectChatGPTCredentials(JSON.stringify({ version: 1, ...tokens })),
    { mode: 0o600 },
  )
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zanii-kimi-auth-'))
  process.env.CLAUDE_CONFIG_DIR = directory
  process.env.OPENAI_AUTH_MODE = 'kimi'
  delete process.env.KIMI_CODE_BASE_URL
  delete process.env.KIMI_REGION
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/api/oauth/device_authorization'))
      return json({
        device_code: 'device-1',
        user_code: 'ABCD-1234',
        verification_uri:
          verificationURL ??
          `https://www.${new URL(url).hostname.slice(5)}/code/authorize_device`,
        verification_uri_complete:
          verificationURL ??
          `https://www.${new URL(url).hostname.slice(5)}/code/authorize_device?user_code=ABCD-1234`,
        interval: 0.01,
        expires_in: 60,
      })
    if (url.endsWith('/api/oauth/token')) {
      const params = new URLSearchParams(String(init?.body))
      if (params.get('grant_type') === 'refresh_token') {
        if (refreshStatus !== 200)
          return json({ error: 'invalid_grant' }, refreshStatus)
        return json({
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-refresh',
          expires_in: 900,
        })
      }
      polls += 1
      // First poll exercises authorization_pending; the second succeeds.
      if (polls === 1) return json({ error: 'authorization_pending' }, 400)
      return json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 900,
      })
    }
    throw new Error(`unexpected request ${url}`)
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfig
  if (originalAuthMode === undefined) delete process.env.OPENAI_AUTH_MODE
  else process.env.OPENAI_AUTH_MODE = originalAuthMode
  if (originalBaseURL === undefined) delete process.env.KIMI_CODE_BASE_URL
  else process.env.KIMI_CODE_BASE_URL = originalBaseURL
  if (originalRegion === undefined) delete process.env.KIMI_REGION
  else process.env.KIMI_REGION = originalRegion
  await rm(directory, { recursive: true, force: true })
})

describe('kimiAuth', () => {
  test('device flow waits through authorization_pending and stores tokens', async () => {
    const login = await startKimiLogin()
    expect(login.userCode).toBe('ABCD-1234')
    expect(login.verificationUriComplete).toContain('kimi.com')
    expect(await login.complete()).toMatchObject({ loggedIn: true })

    const stored = JSON.parse(
      await unprotectChatGPTCredentials(
        await readFile(join(directory, 'kimi-auth.json'), 'utf8'),
      ),
    )
    expect(stored).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    })
    expect(await getKimiAuthStatus()).toMatchObject({ loggedIn: true })

    const auth = await getValidKimiAuth()
    expect(auth.accessToken).toBe('access-1')
    expect(auth.baseURL).toBe('https://api.kimi.com/coding/v1')
    expect(
      requests.every(url => url.startsWith('https://auth.kimi.com/')),
    ).toBe(true)
  })

  test('refreshes an expired token and persists the rotated grant', async () => {
    await seed({
      accessToken: 'stale-access',
      refreshToken: 'stale-refresh',
      expiresAt: Date.now() - 1_000,
    })
    const auth = await getValidKimiAuth()
    expect(auth.accessToken).toBe('refreshed-access')
    const stored = JSON.parse(
      await unprotectChatGPTCredentials(
        await readFile(join(directory, 'kimi-auth.json'), 'utf8'),
      ),
    )
    expect(stored.refreshToken).toBe('refreshed-refresh')
    expect(auth.baseURL).toBe('https://api.kimi.com/coding/v1')
    expect(stored.region).toBe('cn')
  })

  test('clears the credential when the refresh grant is rejected', async () => {
    await seed({
      accessToken: 'stale-access',
      refreshToken: 'revoked-refresh',
      expiresAt: Date.now() - 1_000,
    })
    refreshStatus = 401
    await expect(getValidKimiAuth()).rejects.toMatchObject({
      code: 'token_expired',
    })
    await expect(stat(join(directory, 'kimi-auth.json'))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    )
    refreshStatus = 200
  })

  test('defaults to China and accepts explicit region aliases', () => {
    expect(resolveKimiRegion()).toBe('cn')
    expect(resolveKimiRegion(' GLOBAL ')).toBe('global')
    expect(resolveKimiRegion('international')).toBe('global')
    expect(resolveKimiRegion('china')).toBe('cn')
  })

  test('explicit region overrides the environment', () => {
    process.env.KIMI_REGION = 'global'
    try {
      expect(resolveKimiRegion()).toBe('global')
      expect(resolveKimiRegion('cn')).toBe('cn')
    } finally {
      delete process.env.KIMI_REGION
    }
  })

  test('rejects an unknown environment region before making a request', async () => {
    const requestCount = requests.length
    process.env.KIMI_REGION = 'unknown'
    try {
      await expect(startKimiLogin()).rejects.toMatchObject({
        code: 'invalid_region',
      })
      expect(requests.length).toBe(requestCount)
    } finally {
      delete process.env.KIMI_REGION
    }
  })

  test('global sign-in stores its region and uses the global API', async () => {
    const requestCount = requests.length
    const login = await startKimiLogin(undefined, 'global')
    expect(login.verificationUriComplete).toContain('www.kimi.ai/')
    await login.complete()
    expect(await getKimiAuthStatus()).toMatchObject({
      loggedIn: true,
      region: 'global',
    })
    expect((await getValidKimiAuth()).baseURL).toBe(
      'https://api.kimi.ai/coding/v1',
    )
    expect(
      requests
        .slice(requestCount)
        .every(url => url.startsWith('https://auth.kimi.ai/')),
    ).toBe(true)
  })

  test('concurrent refresh uses the saved region and rotates only once', async () => {
    await seed({
      region: 'global',
      accessToken: 'stale-access',
      refreshToken: 'stale-refresh',
      expiresAt: Date.now() - 1_000,
    })
    const requestCount = requests.length
    const results = await Promise.all([
      getValidKimiAuth(),
      getValidKimiAuth(),
      getValidKimiAuth(),
    ])
    expect(requests.slice(requestCount)).toEqual([
      'https://auth.kimi.ai/api/oauth/token',
    ])
    expect(results.every(auth => auth.accessToken === 'refreshed-access')).toBe(
      true,
    )
    expect(
      results.every(auth => auth.baseURL === 'https://api.kimi.ai/coding/v1'),
    ).toBe(true)
    expect(await getKimiAuthStatus()).toMatchObject({ region: 'global' })
  })

  test('the environment does not reroute previously saved credentials', async () => {
    process.env.KIMI_REGION = 'cn'
    try {
      expect((await getValidKimiAuth()).baseURL).toBe(
        'https://api.kimi.ai/coding/v1',
      )
    } finally {
      delete process.env.KIMI_REGION
    }
  })

  test('rejects an untrusted verification host before saving credentials', async () => {
    const previous = await readFile(join(directory, 'kimi-auth.json'), 'utf8')
    verificationURL = 'https://kimi.ai.attacker.example/authorize'
    try {
      await expect(startKimiLogin(undefined, 'global')).rejects.toMatchObject({
        code: 'invalid_response',
      })
      expect(await readFile(join(directory, 'kimi-auth.json'), 'utf8')).toBe(
        previous,
      )
    } finally {
      verificationURL = undefined
    }
  })

  test('cancellation stops authorization before making a request', async () => {
    const controller = new AbortController()
    controller.abort()
    const requestCount = requests.length
    await expect(
      startKimiLogin(controller.signal, 'global'),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(requests.length).toBe(requestCount)
  })
})
