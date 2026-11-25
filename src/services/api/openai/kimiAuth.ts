/**
 * Kimi Code (Moonshot subscription) sign-in.
 *
 * RFC 8628 device-code flow against https://auth.kimi.com. Kimi has no ID
 * token, so there is no identity to verify; the access token is the whole
 * credential. Tokens live next to the ChatGPT ones and use the same
 * platform credential protection.
 */
import { randomUUID } from 'crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod'
import { lock } from '../../../utils/lockfile.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../../utils/settings/settings.js'
import {
  protectChatGPTCredentials,
  unprotectChatGPTCredentials,
} from './chatgptStorage.js'

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const AUTH_FILE = 'kimi-auth.json'
const NETWORK_TIMEOUT_MS = 30_000
const REFRESH_SKEW_MS = 60_000
const MAX_JSON_BYTES = 1024 * 1024
const DEFAULT_POLL_SECONDS = 5
const DEFAULT_LOGIN_TIMEOUT_SECONDS = 15 * 60

/**
 * Kimi Code runs two independent stacks — mainland China (kimi.com) and the
 * rest of the world (kimi.ai). An account and its tokens belong to one of
 * them, so the region picked at sign-in decides both hosts.
 */
export type KimiRegion = 'cn' | 'global'
const REGIONS: Record<KimiRegion, { oauthHost: string; baseURL: string }> = {
  cn: {
    oauthHost: 'https://auth.kimi.com',
    baseURL: 'https://api.kimi.com/coding/v1',
  },
  global: {
    oauthHost: 'https://auth.kimi.ai',
    baseURL: 'https://api.kimi.ai/coding/v1',
  },
}
/** Canonical Kimi Code model id; the service aliases it to the current model. */
export const KIMI_DEFAULT_MODEL = 'kimi-for-coding'

const tokenString = z
  .string()
  .min(1)
  .max(128 * 1024)
const stateSchema = z
  .object({
    version: z.literal(1),
    accessToken: tokenString,
    refreshToken: tokenString,
    expiresAt: z.number().finite().positive(),
    // Absent in credentials written before regions existed; those are all cn.
    region: z.enum(['cn', 'global']).optional(),
  })
  .strict()
type StoredState = z.infer<typeof stateSchema>

const deviceSchema = z.object({
  device_code: z.string().min(1).max(4096),
  user_code: z.string().min(1).max(256),
  verification_uri: z.string().min(1).max(2048),
  verification_uri_complete: z.string().min(1).max(4096),
  interval: z.number().finite().positive().optional(),
  expires_in: z.number().finite().positive().optional(),
})
const tokenResponseSchema = z.object({
  access_token: tokenString,
  refresh_token: tokenString,
  expires_in: z.number().finite().positive(),
})

export type KimiAuth = {
  accessToken: string
  baseURL: string
}

export type KimiAuthStatus = {
  loggedIn: boolean
  expiresAt?: number
  region?: KimiRegion
}

export type KimiLogin = {
  verificationUri: string
  verificationUriComplete: string
  userCode: string
  complete: () => Promise<KimiAuthStatus>
  cancel: () => void
}

export class KimiAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'KimiAuthError'
  }
}

const ACTIVATION_MESSAGES = {
  policy:
    'Managed settings require an Anthropic login method or organization. Kimi activation is not allowed under that policy.',
  host_managed:
    'The host manages model providers. Configure the Kimi connection through the host instead of changing app provider settings.',
  settings:
    'The Kimi connection could not be saved. Check user settings permissions and retry.',
  overridden:
    'Higher-priority settings override the Kimi provider or auth mode. Change those settings explicitly and retry; the active connection was not changed.',
} as const

export class KimiActivationError extends Error {
  constructor(readonly code: keyof typeof ACTIVATION_MESSAGES) {
    super(ACTIVATION_MESSAGES[code])
    this.name = 'KimiActivationError'
  }
}

export function isKimiAuthEnabled(): boolean {
  return process.env.OPENAI_AUTH_MODE === 'kimi'
}

/**
 * Resolve the Kimi stack to sign in to. An explicit value wins, then
 * `KIMI_REGION`, then mainland China (the historical default).
 */
export function resolveKimiRegion(value?: string): KimiRegion {
  const raw = (value ?? process.env.KIMI_REGION ?? '').trim().toLowerCase()
  if (!raw) return 'cn'
  if (raw === 'global' || raw === 'intl' || raw === 'international')
    return 'global'
  if (raw === 'cn' || raw === 'china' || raw === 'mainland') return 'cn'
  throw new KimiAuthError(
    `Unknown Kimi region "${raw}". Use "cn" (platform.kimi.com) or "global" (platform.kimi.ai).`,
    'invalid_region',
  )
}

export function kimiBaseURL(region: KimiRegion = 'cn'): string {
  return (process.env.KIMI_CODE_BASE_URL || REGIONS[region].baseURL).replace(
    /\/+$/,
    '',
  )
}

/**
 * Map Claude-style tier names onto the Kimi default model. An explicit Kimi
 * model id (from --model or /model) is sent through unchanged.
 */
export function resolveKimiModel(model: string): string {
  const clean = model.replace(/\[1m\]$/i, '')
  const isClaudeStyle =
    clean === 'default' ||
    clean === 'opus' ||
    clean === 'sonnet' ||
    clean === 'haiku' ||
    /claude/i.test(clean)
  return isClaudeStyle ? process.env.KIMI_MODEL || KIMI_DEFAULT_MODEL : clean
}

function authFilePath(): string {
  return join(
    (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.zaniicode')).normalize(
      'NFC',
    ),
    AUTH_FILE,
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new KimiAuthError('Kimi sign-in cancelled.', 'cancelled')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new KimiAuthError('Kimi sign-in cancelled.', 'cancelled'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new KimiAuthError('Kimi sign-in cancelled.', 'cancelled'))
    }
    // No unref(): Bun never fires an unref'd timer when it is the only
    // pending work, which would hang the login poll loop.
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function readState(path: string): Promise<StoredState | null> {
  let raw: string
  try {
    if ((await stat(path)).size > MAX_JSON_BYTES) throw new Error('oversized')
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new KimiAuthError(
      'Cannot read Kimi credentials. Check the app credential file permissions.',
      'storage_error',
    )
  }
  try {
    return stateSchema.parse(JSON.parse(await unprotectChatGPTCredentials(raw)))
  } catch {
    throw new KimiAuthError(
      'Kimi credentials are invalid or cannot be decrypted. Sign in again on the device that created them.',
      'storage_error',
    )
  }
}

async function saveState(path: string, state: StoredState): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const encoded = await protectChatGPTCredentials(
      JSON.stringify(stateSchema.parse(state)),
    )
    await writeFile(temporary, encoded, { mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') await chmod(temporary, 0o600)
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

async function clearState(path: string): Promise<void> {
  await unlink(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}

async function withLock<T>(action: () => Promise<T>): Promise<T> {
  const path = authFilePath()
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
  const release = await lock(path, {
    realpath: false,
    stale: 60_000,
    update: 10_000,
    retries: {
      retries: 40,
      minTimeout: 100,
      maxTimeout: 250,
      randomize: true,
    },
  })
  try {
    return await action()
  } finally {
    await release()
  }
}

async function request(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal)
  const timeout = AbortSignal.timeout(NETWORK_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch {
    throwIfAborted(signal)
    throw new KimiAuthError(
      'Cannot reach Kimi authentication. Check the connection and try again.',
      'network_error',
    )
  }
}

async function readJSON(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new KimiAuthError(
      'Kimi returned an empty authentication response.',
      'invalid_response',
    )
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_JSON_BYTES)
        throw new KimiAuthError(
          'Kimi authentication response exceeded the size limit.',
          'invalid_response',
        )
      chunks.push(part.value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not object')
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof KimiAuthError) throw error
    throw new KimiAuthError(
      'Kimi returned an invalid authentication response.',
      'invalid_response',
    )
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function safeVerificationURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new KimiAuthError(
      'Kimi returned an invalid sign-in link.',
      'invalid_response',
    )
  }
  const isKimiHost = (host: string, domain: string) =>
    host === domain || host.endsWith(`.${domain}`)
  if (
    url.protocol !== 'https:' ||
    !(
      isKimiHost(url.hostname, 'kimi.com') ||
      isKimiHost(url.hostname, 'kimi.ai')
    )
  )
    throw new KimiAuthError(
      'Kimi returned an unexpected sign-in host.',
      'invalid_response',
    )
  return url.href
}

function tokensFromResponse(
  data: Record<string, unknown>,
): Omit<StoredState, 'version'> {
  let parsed: z.infer<typeof tokenResponseSchema>
  try {
    parsed = tokenResponseSchema.parse(data)
  } catch {
    throw new KimiAuthError(
      'Kimi returned an invalid token response. Existing credentials were preserved.',
      'invalid_response',
    )
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    // Cap the lifetime so a bogus expires_in cannot pin a credential for years.
    expiresAt: Date.now() + Math.min(parsed.expires_in, 86_400) * 1000,
  }
}

async function refreshAccessToken(
  oauthHost: string,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<Omit<StoredState, 'version' | 'region'>> {
  for (let attempt = 0; ; attempt++) {
    const response = await request(
      `${oauthHost}/api/oauth/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      },
      signal,
    )
    const data = await readJSON(response)
    if (response.ok) return tokensFromResponse(data)
    const code = typeof data.error === 'string' ? data.error : ''
    // 401/403/invalid_grant means the stored grant is dead; keep retrying only
    // on transient server/rate-limit failures.
    if (
      response.status === 401 ||
      response.status === 403 ||
      code === 'invalid_grant' ||
      code === 'invalid_refresh_token'
    )
      throw new KimiAuthError(
        'Kimi access has expired. Run /login to sign in again.',
        'token_expired',
        response.status,
      )
    if ((response.status === 429 || response.status >= 500) && attempt < 1) {
      await sleep(1_000, signal)
      continue
    }
    throw new KimiAuthError(
      `Kimi token refresh failed (HTTP ${response.status}). Try again shortly.`,
      'refresh_error',
      response.status,
    )
  }
}

export async function startKimiLogin(
  signal?: AbortSignal,
  region: KimiRegion = resolveKimiRegion(),
): Promise<KimiLogin> {
  throwIfAborted(signal)
  const { oauthHost } = REGIONS[region]
  const response = await request(
    `${oauthHost}/api/oauth/device_authorization`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ client_id: CLIENT_ID }),
    },
    signal,
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new KimiAuthError(
      'Kimi sign-in is temporarily unavailable. Try again shortly.',
      'device_authorization_error',
      response.status,
    )
  }
  let device: z.infer<typeof deviceSchema>
  try {
    device = deviceSchema.parse(await readJSON(response))
  } catch (error) {
    if (error instanceof KimiAuthError) throw error
    throw new KimiAuthError(
      'Kimi returned an invalid device authorization response.',
      'invalid_response',
    )
  }
  const verificationUri = safeVerificationURL(device.verification_uri)
  const verificationUriComplete = safeVerificationURL(
    device.verification_uri_complete,
  )
  const intervalMs = (device.interval ?? DEFAULT_POLL_SECONDS) * 1000
  const deadline =
    Date.now() + (device.expires_in ?? DEFAULT_LOGIN_TIMEOUT_SECONDS) * 1000
  const controller = new AbortController()
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal

  const cancel = () => controller.abort()

  let completion: Promise<KimiAuthStatus> | undefined
  const complete = () => {
    completion ??= (async () => {
      let waitMs = intervalMs
      try {
        for (;;) {
          await sleep(waitMs, combined)
          if (Date.now() > deadline)
            throw new KimiAuthError(
              'Kimi sign-in expired. Run /login again.',
              'expired_token',
            )
          const poll = await request(
            `${oauthHost}/api/oauth/token`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
              body: new URLSearchParams({
                client_id: CLIENT_ID,
                device_code: device.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              }),
            },
            combined,
          )
          const data = await readJSON(poll)
          if (poll.ok) {
            const tokens = tokensFromResponse(data)
            return await withLock(async () => {
              await saveState(authFilePath(), {
                version: 1,
                region,
                ...tokens,
              })
              return { loggedIn: true, expiresAt: tokens.expiresAt }
            })
          }
          const code = typeof data.error === 'string' ? data.error : ''
          if (code === 'authorization_pending') continue
          if (code === 'slow_down') {
            waitMs += 5_000
            continue
          }
          if (code === 'expired_token')
            throw new KimiAuthError(
              'Kimi sign-in expired. Run /login again.',
              'expired_token',
              poll.status,
            )
          if (code === 'access_denied')
            throw new KimiAuthError(
              'Kimi sign-in was denied.',
              'denied',
              poll.status,
            )
          throw new KimiAuthError(
            `Kimi authentication failed (HTTP ${poll.status}). Try signing in again.`,
            'token_error',
            poll.status,
          )
        }
      } finally {
        cancel()
      }
    })()
    void completion.catch(() => {})
    return completion
  }

  return {
    verificationUri,
    verificationUriComplete,
    userCode: device.user_code,
    complete,
    cancel,
  }
}

export async function getKimiAuthStatus(): Promise<KimiAuthStatus> {
  const state = await readState(authFilePath())
  return state
    ? {
        loggedIn: true,
        expiresAt: state.expiresAt,
        region: state.region ?? 'cn',
      }
    : { loggedIn: false }
}

export async function getValidKimiAuth(
  signal?: AbortSignal,
): Promise<KimiAuth> {
  throwIfAborted(signal)
  return withLock(async () => {
    const path = authFilePath()
    const state = await readState(path)
    if (!state)
      throw new KimiAuthError(
        'Kimi is not connected to this app. Run /login and choose Continue with Kimi.',
        'not_logged_in',
      )
    const region = state.region ?? 'cn'
    if (state.expiresAt <= Date.now() + REFRESH_SKEW_MS) {
      try {
        const tokens = await refreshAccessToken(
          REGIONS[region].oauthHost,
          state.refreshToken,
          signal,
        )
        await saveState(path, { version: 1, region, ...tokens })
        return { accessToken: tokens.accessToken, baseURL: kimiBaseURL(region) }
      } catch (error) {
        if (error instanceof KimiAuthError && error.code === 'token_expired') {
          await clearState(path)
        }
        throw error
      }
    }
    return { accessToken: state.accessToken, baseURL: kimiBaseURL(region) }
  })
}

export async function removeKimiAuth(): Promise<{ warning?: string }> {
  return withLock(async () => {
    const path = authFilePath()
    try {
      await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new KimiAuthError(
        'Kimi credentials could not be removed. Check app credential file permissions.',
        'storage_error',
      )
    }
    await clearState(path)
    return {
      warning:
        'Signed out of Kimi locally. Kimi does not expose a public revocation endpoint; remove this app from your Kimi account devices if you need remote revocation.',
    }
  })
}

export function activateKimiSubscription(): void {
  if (isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST))
    throw new KimiActivationError('host_managed')
  try {
    const before = getInitialSettings()
    if (before.forceLoginMethod || before.forceLoginOrgUUID)
      throw new KimiActivationError('policy')
    const { error } = updateSettingsForSource('userSettings', {
      modelType: 'openai',
      env: { OPENAI_AUTH_MODE: 'kimi' },
    })
    if (error) throw new KimiActivationError('settings')
    const effective = getInitialSettings()
    if (effective.forceLoginMethod || effective.forceLoginOrgUUID)
      throw new KimiActivationError('policy')
    if (
      effective.modelType !== 'openai' ||
      effective.env?.OPENAI_AUTH_MODE !== 'kimi'
    )
      throw new KimiActivationError('overridden')
  } catch (error) {
    if (error instanceof KimiActivationError) throw error
    throw new KimiActivationError('settings')
  }
  process.env.OPENAI_AUTH_MODE = 'kimi'
}
