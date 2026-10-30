import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getKimiAuthStatus,
  getValidKimiAuth,
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
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input)
    if (url.endsWith('/api/oauth/device_authorization'))
      return json({
        device_code: 'device-1',
        user_code: 'ABCD-1234',
        verification_uri: 'https://www.kimi.com/code/authorize_device',
        verification_uri_complete:
          'https://www.kimi.com/code/authorize_device?user_code=ABCD-1234',
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
})
