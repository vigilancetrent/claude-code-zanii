#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { mock } from 'bun:test'

const mode = process.argv[2]
assert.ok(
  ['setup', 'refresh', 'check', 'logout', 'check-logout'].includes(mode ?? ''),
)
const directory = resolve(
  import.meta.dir,
  '../tasks/verification/auth-concurrency-fixture',
)
assert.ok(directory.startsWith(resolve(import.meta.dir, '..') + sep))
const authFile = join(directory, 'openai-chatgpt-auth.json')
const counterFile = join(directory, 'refreshes.log')
const overlapFile = join(directory, 'workers.log')
process.env.CLAUDE_CONFIG_DIR = directory

if (mode === 'setup') {
  await mkdir(directory, { recursive: true })
  await writeFile(
    authFile,
    JSON.stringify({
      version: 1,
      hostId: `urn:uuid:${randomUUID()}`,
      generation: randomUUID(),
      clientId: 'synthetic-concurrency-client',
      subject: 'synthetic-concurrency-subject',
      tokens: {
        idToken: 'synthetic-expired-id',
        accessToken: 'synthetic-expired-access',
        refreshToken: 'synthetic-refresh',
        scopes: ['chatgpt.tokens.use.direct'],
        expiresAt: Date.now() - 1000,
      },
    }),
    { mode: 0o600 },
  )
  await writeFile(counterFile, '')
  await writeFile(overlapFile, '')
} else if (mode === 'check' || mode === 'check-logout') {
  const count = (await readFile(counterFile, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean).length
  const state = JSON.parse(await readFile(authFile, 'utf8'))
  assert.equal(count, 1, 'Concurrent processes must perform one token rotation')
  assert.equal(state.clientId, 'synthetic-concurrency-client')
  assert.equal(Boolean(state.tokens), mode === 'check')
  const phases = (await readFile(overlapFile, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(
      line => JSON.parse(line) as { mode: string; phase: string; time: number },
    )
    .filter(phase => phase.mode === 'refresh')
    .sort((a, b) => a.time - b.time)
  let active = 0
  let maximum = 0
  for (const phase of phases) {
    active += phase.phase === 'start' ? 1 : -1
    maximum = Math.max(maximum, active)
  }
  assert.equal(phases.filter(phase => phase.phase === 'start').length, 8)
  assert.ok(maximum > 1, 'Workers must overlap to establish actual concurrency')
  assert.equal(active, 0)
  process.stdout.write(
    JSON.stringify({
      mode,
      refreshCount: count,
      tokensPresent: Boolean(state.tokens),
      maximumConcurrentWorkers: maximum,
    }) + '\n',
  )
} else {
  // Only platform encryption and external HTTP are replaced; real file locking is exercised.
  mock.module('src/services/api/openai/chatgptStorage.ts', () => ({
    protectChatGPTCredentials: async (value: string) => value,
    unprotectChatGPTCredentials: async (value: string) => value,
  }))
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const issuer = 'https://auth.openai.com'
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'synthetic-key' }),
  ).toString('base64url')
  const claims = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: 'synthetic-concurrency-client',
      sub: 'synthetic-concurrency-subject',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url')
  const unsigned = `${header}.${claims}`
  const idToken = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`
  globalThis.fetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          jwks_uri: `${issuer}/oauth/jwks`,
          revocation_endpoint: `${issuer}/oauth/revoke`,
        })
      }
      if (url === `${issuer}/oauth/jwks`) {
        return Response.json({
          keys: [
            {
              ...publicKey.export({ format: 'jwk' }),
              kid: 'synthetic-key',
              alg: 'RS256',
              use: 'sig',
            },
          ],
        })
      }
      if (url === `${issuer}/oauth/token`) {
        await appendFile(counterFile, `${process.pid}\n`)
        await Bun.sleep(500)
        return Response.json({
          id_token: idToken,
          access_token: 'synthetic-refreshed-access',
          refresh_token: 'synthetic-rotated-refresh',
          scope: 'chatgpt.tokens.use.direct',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }
      if (url === `${issuer}/oauth/revoke`)
        return new Response(null, { status: 200 })
      throw new Error(
        'Unexpected external request in synthetic concurrency check',
      )
    },
    globalThis.fetch,
  )
  const auth = await import('../src/services/api/openai/chatgptAuth.js')
  await appendFile(
    overlapFile,
    `${JSON.stringify({ pid: process.pid, mode, phase: 'start', time: Date.now() })}\n`,
  )
  if (mode === 'refresh') {
    const result = await auth.getValidChatGPTAuth()
    assert.equal(result.accessToken, 'synthetic-refreshed-access')
  } else {
    assert.deepEqual(await auth.removeChatGPTAuth(), {})
  }
  await appendFile(
    overlapFile,
    `${JSON.stringify({ pid: process.pid, mode, phase: 'end', time: Date.now() })}\n`,
  )
}
