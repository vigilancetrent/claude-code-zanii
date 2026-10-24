import {
  createHash,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { createServer } from 'http'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '../../oauth/crypto.js'
import { lock } from '../../../utils/lockfile.js'
import {
  protectChatGPTCredentials,
  unprotectChatGPTCredentials,
} from './chatgptStorage.js'

const ISSUER = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const AUTH_FILE = 'openai-chatgpt-auth.json'
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
const NETWORK_TIMEOUT_MS = 15_000
const LOGIN_TIMEOUT_MS = 10 * 60_000
const REFRESH_SKEW_MS = 60_000
const MAX_JSON_BYTES = 1024 * 1024
const OAUTH_ERROR_CODES = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])
const tokenString = z
  .string()
  .min(1)
  .max(128 * 1024)
const tokensSchema = z
  .object({
    idToken: tokenString,
    accessToken: tokenString,
    refreshToken: tokenString.optional(),
    scopes: z.array(z.string().max(256)).max(64),
    expiresAt: z.number().finite().positive(),
    earliestRefreshAt: z.number().finite().nonnegative().optional(),
  })
  .strict()
const stateSchema = z
  .object({
    version: z.literal(1),
    hostId: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/i),
    generation: z.string().uuid(),
    clientId: z.string().min(1).max(256).optional(),
    subject: z.string().min(1).max(512).optional(),
    email: z.string().max(512).optional(),
    tokens: tokensSchema.optional(),
  })
  .strict()
type StoredState = z.infer<typeof stateSchema>
type StoredTokens = z.infer<typeof tokensSchema>

export type ChatGPTAuthTokens = {
  idToken: string
  accessToken: string
  refreshToken?: string
  accountId?: string
  accountKey: string
  email?: string
  planUsageEnabled: boolean
}

export type ChatGPTAuth = {
  accessToken: string
  accountId?: string
  accountKey: string
}
export type ChatGPTLogin = {
  authorizationUrl: string
  complete: () => Promise<ChatGPTAuthTokens>
  cancel: () => void
}
export type ChatGPTAuthStatus = {
  loggedIn: boolean
  planUsageEnabled: boolean
  accountId?: string
  accountKey?: string
  email?: string
}

export class ChatGPTAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ChatGPTAuthError'
  }
}

function authFilePath(): string {
  return join(
    (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.zaniicode')).normalize(
      'NFC',
    ),
    AUTH_FILE,
  )
}
function freshState(): StoredState {
  return {
    version: 1,
    hostId: `urn:uuid:${randomUUID()}`,
    generation: randomUUID(),
  }
}
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ChatGPTAuthError(
      'ChatGPT login or request cancelled.',
      'cancelled',
    )
}
function identityKey(state: StoredState): string {
  return createHash('sha256')
    .update(JSON.stringify([ISSUER, state.clientId, state.subject]))
    .digest('hex')
}

async function readState(path: string): Promise<StoredState | null> {
  let raw: string
  try {
    if ((await stat(path)).size > MAX_JSON_BYTES) throw new Error('oversized')
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new ChatGPTAuthError(
      'Cannot read ChatGPT credentials. Check the app credential file permissions.',
      'storage_error',
    )
  }
  try {
    const decoded = await unprotectChatGPTCredentials(raw)
    const parsed: unknown = JSON.parse(decoded)
    // Old Codex-based credentials require new app consent; never import or refresh them.
    if (parsed && typeof parsed === 'object' && !('version' in parsed))
      return null
    const state = stateSchema.parse(parsed)
    if (state.tokens && (!state.clientId || !state.subject))
      throw new Error('missing identity')
    if (state.clientId === 'dynamic_agent_client')
      throw new Error('unregistered client')
    return state
  } catch {
    throw new ChatGPTAuthError(
      'ChatGPT credentials are invalid or cannot be decrypted. Sign in again on the device that created them.',
      'storage_error',
    )
  }
}

async function saveState(
  path: string,
  state: StoredState,
  signal?: AbortSignal,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const encoded = await protectChatGPTCredentials(
      JSON.stringify(stateSchema.parse(state)),
    )
    cancelled(signal)
    await writeFile(temporary, encoded, { mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') await chmod(temporary, 0o600)
    cancelled(signal)
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

const localQueues = new Map<string, Promise<void>>()
async function withStateLock<T>(
  path: string,
  action: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const previous = localQueues.get(path) ?? Promise.resolve()
  let resolveQueue!: () => void
  const current = new Promise<void>(resolve => {
    resolveQueue = resolve
  })
  localQueues.set(path, current)
  let entered = false
  let release: (() => Promise<void>) | undefined
  const waitSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000)
  let stopWaiting!: () => void
  const waitCancelled = new Promise<never>((_, reject) => {
    stopWaiting = () =>
      reject(
        new ChatGPTAuthError(
          signal?.aborted
            ? 'ChatGPT login or request cancelled.'
            : 'Timed out waiting for another ChatGPT credential operation.',
          signal?.aborted ? 'cancelled' : 'lock_timeout',
        ),
      )
    waitSignal.addEventListener('abort', stopWaiting, { once: true })
    if (waitSignal.aborted) stopWaiting()
  })
  const finishQueue = () => {
    resolveQueue()
    if (localQueues.get(path) === current) localQueues.delete(path)
  }
  try {
    await Promise.race([previous, waitCancelled])
    entered = true
    cancelled(signal)
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
    release = await lock(path, {
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
    cancelled(signal)
    return await action()
  } finally {
    waitSignal.removeEventListener('abort', stopWaiting)
    try {
      await release?.()
    } finally {
      if (entered) finishQueue()
      else void previous.then(finishQueue)
    }
  }
}

async function readJSON(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new ChatGPTAuthError(
      'OpenAI returned an empty authentication response.',
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
        throw new ChatGPTAuthError(
          'OpenAI authentication response exceeded the size limit.',
          'invalid_response',
        )
      chunks.push(part.value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not object')
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof ChatGPTAuthError) throw error
    throw new ChatGPTAuthError(
      'OpenAI returned an invalid authentication response.',
      'invalid_response',
    )
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function safeEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048)
    throw new ChatGPTAuthError(
      'OpenAI discovery is missing an authentication endpoint.',
      'invalid_discovery',
    )
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ChatGPTAuthError(
      'OpenAI discovery returned an invalid authentication endpoint.',
      'invalid_discovery',
    )
  }
  if (url.origin !== ISSUER || url.username || url.password || url.hash)
    throw new ChatGPTAuthError(
      'OpenAI discovery returned an unexpected authentication host.',
      'invalid_discovery',
    )
  return url.href
}
async function request(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  cancelled(signal)
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(NETWORK_TIMEOUT_MS)])
        : AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    })
  } catch {
    cancelled(signal)
    throw new ChatGPTAuthError(
      'Cannot reach OpenAI authentication. Check the connection and try again.',
      'network_error',
    )
  }
}
async function discovery(signal?: AbortSignal): Promise<{
  authorize: string
  token: string
  jwks: string
  revoke?: string
}> {
  const response = await request(
    `${ISSUER}/.well-known/openid-configuration`,
    {},
    signal,
  )
  if (!response.ok)
    throw new ChatGPTAuthError(
      'OpenAI authentication discovery is temporarily unavailable.',
      'discovery_error',
      response.status,
    )
  const data = await readJSON(response)
  if (data.issuer !== ISSUER)
    throw new ChatGPTAuthError(
      'OpenAI authentication issuer did not match.',
      'invalid_issuer',
    )
  return {
    authorize: safeEndpoint(data.authorization_endpoint),
    token: safeEndpoint(data.token_endpoint),
    jwks: safeEndpoint(data.jwks_uri),
    revoke:
      data.revocation_endpoint === undefined
        ? undefined
        : safeEndpoint(data.revocation_endpoint),
  }
}
async function tokenRequest(
  url: string,
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    signal,
  )
  const data = await readJSON(response)
  if (!response.ok) {
    const candidate = typeof data.error === 'string' ? data.error : undefined
    const safeCode =
      candidate && OAUTH_ERROR_CODES.has(candidate) ? candidate : 'token_error'
    throw new ChatGPTAuthError(
      `ChatGPT authentication failed (${response.status}, ${safeCode}). Try signing in again if access was revoked.`,
      safeCode,
      response.status,
    )
  }
  return data
}

async function validateIdentity(
  token: string,
  clientId: string,
  jwks: string,
  nonce?: string,
  subject?: string,
  signal?: AbortSignal,
): Promise<{ subject: string; email?: string }> {
  try {
    if (token.length > 128 * 1024) throw new Error('oversized token')
    const parts = token.split('.')
    if (
      parts.length !== 3 ||
      parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      throw new Error('malformed token')
    const [head, payload, signature] = parts as [string, string, string]
    const header = JSON.parse(
      Buffer.from(head, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    if (
      header.alg !== 'RS256' &&
      header.alg !== 'ES256' &&
      header.alg !== 'EdDSA'
    )
      throw new Error('unsupported algorithm')
    if (
      typeof header.kid !== 'string' ||
      header.kid.length > 256 ||
      header.crit !== undefined
    )
      throw new Error('invalid header')
    const response = await request(jwks, {}, signal)
    if (!response.ok)
      throw new ChatGPTAuthError(
        'OpenAI signing keys are temporarily unavailable.',
        'jwks_error',
        response.status,
      )
    const keyData = await readJSON(response)
    const keys = z
      .array(z.record(z.string(), z.unknown()))
      .max(100)
      .parse(keyData.keys)
    const matching = keys.filter(
      key =>
        key.kid === header.kid &&
        (key.alg === undefined || key.alg === header.alg) &&
        (key.use === undefined || key.use === 'sig'),
    )
    if (matching.length !== 1) throw new Error('missing signing key')
    const jwk = matching[0]!
    if (header.alg === 'RS256' && jwk.kty !== 'RSA')
      throw new Error('wrong key type')
    if (header.alg === 'ES256' && (jwk.kty !== 'EC' || jwk.crv !== 'P-256'))
      throw new Error('wrong curve')
    if (header.alg === 'EdDSA' && (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519'))
      throw new Error('wrong curve')
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
    if (
      header.alg === 'RS256' &&
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error('weak key')
    const algorithm =
      header.alg === 'RS256'
        ? 'RSA-SHA256'
        : header.alg === 'ES256'
          ? 'sha256'
          : null
    if (
      !verify(
        algorithm,
        Buffer.from(`${head}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      )
    )
      throw new Error('bad signature')
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    const audiences =
      typeof claims.aud === 'string'
        ? [claims.aud]
        : z.array(z.string()).parse(claims.aud)
    const now = Date.now() / 1000
    if (
      claims.iss !== ISSUER ||
      !audiences.includes(clientId) ||
      (audiences.length > 1 && claims.azp !== clientId)
    )
      throw new Error('issuer/audience mismatch')
    if (
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== 'number' ||
          !Number.isFinite(claims.nbf) ||
          claims.nbf > now + 30))
    )
      throw new Error('expired/not yet valid')
    if (nonce !== undefined && claims.nonce !== nonce)
      throw new Error('nonce mismatch')
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 512 ||
      (subject !== undefined && claims.sub !== subject)
    )
      throw new Error('identity mismatch')
    return {
      subject: claims.sub,
      email:
        typeof claims.email === 'string' && claims.email.length <= 512
          ? claims.email
          : undefined,
    }
  } catch (error) {
    if (error instanceof ChatGPTAuthError) throw error
    throw new ChatGPTAuthError(
      'OpenAI identity validation failed. No credentials were saved.',
      'invalid_identity',
    )
  }
}

function tokensFromResponse(
  data: Record<string, unknown>,
  previous?: StoredTokens,
): StoredTokens {
  try {
    const response = z
      .object({
        id_token: tokenString,
        access_token: tokenString,
        refresh_token: tokenString.optional(),
        token_type: z
          .string()
          .refine(value => value.toLowerCase() === 'bearer'),
        expires_in: z.number().finite().positive().max(86400),
        scope: z.string().max(4096).optional(),
        earliest_refresh_at: z
          .union([z.number().finite().nonnegative(), z.string().max(64)])
          .optional(),
      })
      .parse(data)
    const earliest = response.earliest_refresh_at
    const earliestMs =
      typeof earliest === 'number'
        ? earliest < 1e12
          ? earliest * 1000
          : earliest
        : earliest === undefined
          ? undefined
          : Date.parse(earliest)
    return tokensSchema.parse({
      idToken: response.id_token,
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? previous?.refreshToken,
      scopes:
        response.scope === undefined
          ? (previous?.scopes ?? [])
          : [...new Set(response.scope.split(/\s+/).filter(Boolean))],
      expiresAt: Date.now() + response.expires_in * 1000,
      earliestRefreshAt: earliestMs,
    })
  } catch {
    throw new ChatGPTAuthError(
      'OpenAI returned an invalid token response. Existing credentials were preserved.',
      'invalid_response',
    )
  }
}
function publicTokens(state: StoredState): ChatGPTAuthTokens {
  const tokens = state.tokens!
  return {
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountId: state.subject,
    accountKey: identityKey(state),
    email: state.email,
    planUsageEnabled: tokens.scopes.includes(DIRECT_SCOPE),
  }
}

export async function startChatGPTLogin(
  signal?: AbortSignal,
): Promise<ChatGPTLogin> {
  cancelled(signal)
  const path = authFilePath()
  const pending = await withStateLock(
    path,
    async () => {
      const state = (await readState(path)) ?? freshState()
      await saveState(path, state)
      return state
    },
    signal,
  )
  const endpoints = await discovery(signal)
  const state = generateState()
  const nonce = generateState()
  const verifier = generateCodeVerifier()
  const controller = new AbortController()
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal
  let resolveCallback!: (value: { code: string; clientId: string }) => void
  let rejectCallback!: (error: Error) => void
  const callback = new Promise<{ code: string; clientId: string }>(
    (resolve, reject) => {
      resolveCallback = resolve
      rejectCallback = reject
    },
  )
  // The browser can finish before complete() is called by the UI.
  void callback.catch(() => {})
  let settled = false
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    )
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      res.writeHead(400)
      res.end('Invalid authorization callback.')
      return
    }
    if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
      res.writeHead(404)
      res.end('Not found.')
      return
    }
    const values = url.searchParams
    const returnedState = values.get('state') ?? ''
    const returnedStateBytes = Buffer.from(returnedState)
    const expectedStateBytes = Buffer.from(state)
    if (
      settled ||
      values.getAll('state').length !== 1 ||
      returnedStateBytes.length !== expectedStateBytes.length ||
      !timingSafeEqual(returnedStateBytes, expectedStateBytes)
    ) {
      res.writeHead(400)
      res.end('Invalid authorization state. Return to the app and try again.')
      return
    }
    settled = true
    const code = values.get('code')
    const clientId = values.get('client_id') ?? pending.clientId
    const returnedIssuer = values.get('iss')
    if (
      values.has('error') ||
      values.getAll('code').length !== 1 ||
      values.getAll('client_id').length > 1 ||
      values.getAll('iss').length > 1 ||
      !code ||
      code.length > 4096 ||
      !clientId ||
      clientId.length > 256 ||
      clientId === 'dynamic_agent_client' ||
      (pending.clientId && clientId !== pending.clientId) ||
      (returnedIssuer !== null && returnedIssuer !== ISSUER)
    ) {
      res.writeHead(400)
      res.end('Authorization was declined or invalid. Return to the app.')
      rejectCallback(
        new ChatGPTAuthError(
          'ChatGPT authorization was declined or did not match this app registration.',
          'invalid_callback',
        ),
      )
    } else {
      res.end('Authorization received. Return to the app to finish signing in.')
      resolveCallback({ code, clientId })
    }
    server.close()
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    combined.removeEventListener('abort', cancel)
    controller.abort()
    rejectCallback(
      new ChatGPTAuthError(
        'ChatGPT login cancelled or timed out.',
        'cancelled',
      ),
    )
    server.close()
    server.closeAllConnections()
    if (timer) clearTimeout(timer)
  }
  combined.addEventListener('abort', cancel, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cancelled(combined)
  } catch (error) {
    cancel()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') {
    cancel()
    throw new ChatGPTAuthError(
      'Cannot start the local ChatGPT sign-in callback.',
      'callback_error',
    )
  }
  const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`
  const authorization = new URL(endpoints.authorize)
  authorization.search = new URLSearchParams({
    client_id: pending.clientId ?? 'dynamic_agent_client',
    ext_agent_host_id: pending.hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: generateCodeChallenge(verifier),
    ...(!pending.clientId ? { agent_name_hint: 'Zanii' } : {}),
    ...(pending.tokens && !pending.tokens.scopes.includes(DIRECT_SCOPE)
      ? { prompt: 'consent' }
      : {}),
  }).toString()
  timer = setTimeout(cancel, LOGIN_TIMEOUT_MS)
  timer.unref?.()
  let completion: Promise<ChatGPTAuthTokens> | undefined
  const complete = () => {
    completion ??= (async () => {
      try {
        const result = await callback
        cancelled(combined)
        await withStateLock(
          path,
          async () => {
            const latest = await readState(path)
            if (
              !latest ||
              latest.generation !== pending.generation ||
              (latest.clientId && latest.clientId !== result.clientId)
            )
              throw new ChatGPTAuthError(
                'The ChatGPT account changed while signing in. Start sign-in again.',
                'stale_login',
              )
            await saveState(path, { ...latest, clientId: result.clientId })
          },
          combined,
        )
        const data = await tokenRequest(
          endpoints.token,
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: result.clientId,
            code: result.code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            resource: RESOURCE,
          }),
          combined,
        )
        const tokens = tokensFromResponse(data)
        const identity = await validateIdentity(
          tokens.idToken,
          result.clientId,
          endpoints.jwks,
          nonce,
          pending.subject,
          combined,
        )
        return await withStateLock(
          path,
          async () => {
            const latest = await readState(path)
            if (
              !latest ||
              latest.generation !== pending.generation ||
              latest.clientId !== result.clientId
            )
              throw new ChatGPTAuthError(
                'The ChatGPT account changed while signing in. Start sign-in again.',
                'stale_login',
              )
            cancelled(combined)
            const saved: StoredState = {
              ...latest,
              subject: identity.subject,
              email: identity.email,
              tokens,
              generation: randomUUID(),
            }
            await saveState(path, saved, combined)
            return publicTokens(saved)
          },
          combined,
        )
      } finally {
        cancel()
      }
    })()
    void completion.catch(() => {})
    return completion
  }
  return { authorizationUrl: authorization.href, complete, cancel }
}

export function isChatGPTAuthEnabled(): boolean {
  return process.env.OPENAI_AUTH_MODE === 'chatgpt'
}

export async function getChatGPTAuthStatus(): Promise<ChatGPTAuthStatus> {
  const state = await readState(authFilePath())
  const loggedIn = Boolean(
    state?.tokens &&
      (state.tokens.expiresAt > Date.now() || state.tokens.refreshToken),
  )
  return {
    loggedIn,
    planUsageEnabled: Boolean(
      loggedIn && state?.tokens?.scopes.includes(DIRECT_SCOPE),
    ),
    accountId: state?.subject,
    accountKey: state?.subject ? identityKey(state) : undefined,
    email: state?.email,
  }
}

export async function getValidChatGPTAuth(
  signal?: AbortSignal,
): Promise<ChatGPTAuth> {
  const path = authFilePath()
  return withStateLock(
    path,
    async () => {
      let state = await readState(path)
      if (!state?.tokens || !state.clientId || !state.subject)
        throw new ChatGPTAuthError(
          'ChatGPT is not connected to this app. Run /login and choose Continue with ChatGPT.',
          'not_logged_in',
        )
      if (!state.tokens.scopes.includes(DIRECT_SCOPE))
        throw new ChatGPTAuthError(
          'ChatGPT sign-in is connected, but plan usage is disabled. Run /login to allow ChatGPT plan usage.',
          'plan_usage_disabled',
        )
      const now = Date.now()
      if (
        state.tokens.expiresAt <= now + REFRESH_SKEW_MS &&
        (state.tokens.earliestRefreshAt ?? 0) <= now
      ) {
        if (!state.tokens.refreshToken)
          throw new ChatGPTAuthError(
            'ChatGPT access has expired. Run /login to sign in again.',
            'token_expired',
          )
        try {
          const endpoints = await discovery(signal)
          const data = await tokenRequest(
            endpoints.token,
            new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: state.clientId,
              refresh_token: state.tokens.refreshToken,
              resource: RESOURCE,
            }),
            signal,
          )
          const tokens = tokensFromResponse(data, state.tokens)
          const identity = await validateIdentity(
            tokens.idToken,
            state.clientId,
            endpoints.jwks,
            undefined,
            state.subject,
            signal,
          )
          cancelled(signal)
          state = { ...state, tokens, email: identity.email ?? state.email }
          await saveState(path, state, signal)
        } catch (error) {
          if (
            error instanceof ChatGPTAuthError &&
            [
              'invalid_grant',
              'invalid_refresh_token',
              'token_expired',
              'refresh_token_expired',
              'refresh_token_invalidated',
              'refresh_token_reused',
            ].includes(error.code)
          )
            await saveState(path, {
              ...state,
              tokens: undefined,
              generation: randomUUID(),
            })
          throw error
        }
      }
      if (!state.tokens || state.tokens.expiresAt <= Date.now())
        throw new ChatGPTAuthError(
          'ChatGPT access has expired. Sign in again or retry after the permitted refresh time.',
          'token_expired',
        )
      if (!state.tokens.scopes.includes(DIRECT_SCOPE))
        throw new ChatGPTAuthError(
          'ChatGPT plan usage permission was removed. Run /login to allow it again.',
          'plan_usage_disabled',
        )
      return {
        accessToken: state.tokens.accessToken,
        accountId: state.subject,
        accountKey: identityKey(state),
      }
    },
    signal,
  )
}

export async function removeChatGPTAuth(): Promise<{ warning?: string }> {
  const path = authFilePath()
  return withStateLock(path, async () => {
    let state: StoredState | null
    try {
      state = await readState(path)
    } catch (error) {
      if (
        !(error instanceof ChatGPTAuthError) ||
        error.code !== 'storage_error'
      )
        throw error
      await unlink(path)
      return {
        warning:
          'Cleared unreadable local ChatGPT credentials. Remote revocation was not confirmed; disconnect Zanii in ChatGPT Settings before signing in again.',
      }
    }
    if (!state) {
      await unlink(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
      return {}
    }
    let confirmed = !state.tokens?.refreshToken
    try {
      if (state.tokens?.refreshToken && state.clientId) {
        const endpoints = await discovery()
        if (endpoints.revoke) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await request(endpoints.revoke, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  token: state.tokens.refreshToken,
                  token_type_hint: 'refresh_token',
                  client_id: state.clientId,
                }),
              })
              confirmed = response.status === 200
              await response.body?.cancel()
              if (confirmed || response.status < 500) break
            } catch {
              /* Local sign-out must still complete if OpenAI is unavailable. */
            }
            if (attempt === 0)
              await new Promise(resolve =>
                setTimeout(resolve, 200 + Math.random() * 200),
              )
          }
        }
      }
    } catch {
      /* Discovery failures must not keep a local renewable session alive. */
    }
    await saveState(path, {
      ...state,
      tokens: undefined,
      generation: randomUUID(),
    })
    return confirmed
      ? {}
      : {
          warning:
            'Signed out locally. Remote revocation was not confirmed; disconnect Zanii in ChatGPT Settings to revoke access.',
        }
  })
}
