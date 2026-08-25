import { describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempHome = mkdtempSync(join(tmpdir(), 'zanii-test-'))

// Mirrors hardwareFingerprint(): sha256(raw)[:12]
const expectedFp = createHash('sha256')
  .update('deadbeefcafe1234')
  .digest('hex')
  .slice(0, 12)
mock.module('src/utils/envUtils.js', () => ({
  getClaudeConfigHomeDir: () => tempHome,
}))

interface FetchRecord {
  url: string
  method: string
  auth?: string
  body?: string
}

const fetchCalls: FetchRecord[] = []
let proofRouteStatus = 404

globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const headers = new Headers(init?.headers)
  const rec: FetchRecord = {
    url,
    method,
    auth: headers.get('authorization') ?? undefined,
    body: typeof init?.body === 'string' ? init.body : undefined,
  }
  fetchCalls.push(rec)
  if (url.includes('/v1/sth')) {
    return Response.json({
      v: 1,
      log_id: 'test-log',
      size: 42,
      root: 'sha256:abcdef1234567890',
      ts: '2026-01-01T00:00:00Z',
      sig: 'x',
    })
  }
  if (url.includes('/v1/stats')) {
    return Response.json({ receipts: 1234 })
  }
  if (url.includes('/v1/head/')) {
    return Response.json({ head: null })
  }
  if (url.includes('/v1/account/signup')) {
    return Response.json({ org_id: 7, admin_key: 'zk_admin_test' })
  }
  if (url.includes('/v1/account/keys')) {
    return Response.json({ api_key: 'zk_live_test' })
  }
  if (url.includes('/v1/receipts')) {
    return Response.json({
      results: [{ status: 'accepted', hash: 'sha256:deadbeef', index: 43 }],
      sth: {
        v: 1,
        log_id: 'test-log',
        size: 43,
        root: 'sha256:abcdef1234567890',
        ts: '2026-01-01T00:00:00Z',
        sig: 'x',
      },
    })
  }
  if (url.includes('/v1/proof/')) {
    if (proofRouteStatus === 404) {
      return new Response('not found', { status: 404 })
    }
    // Well-formed but unverifiable payload → ProofCheck{ok:false}
    return Response.json({
      receipt: null,
      hash: 'sha256:deadbeef',
      index: 43,
      proof: [],
      sth: null,
    })
  }
  return new Response('not found', { status: 404 })
}) as unknown as typeof fetch

const {
  _resetZaniiForTesting,
  ensureZaniiAccount,
  isZaniiEnabled,
  zaniiRecordToolCall,
  zaniiStartupProof,
} = await import('../zaniiAgent.js')

describe('zaniiAgent', () => {
  test('enabled via ZANII_PROOF=1 env (runtime toggle)', () => {
    process.env.ZANII_PROOF = '1'
    expect(isZaniiEnabled()).toBe(true)
  })

  test('disabled via ZANII_PROOF=0 env', () => {
    process.env.ZANII_PROOF = '0'
    expect(isZaniiEnabled()).toBe(false)
    delete process.env.ZANII_PROOF
  })

  test('auto-provisions an org + ingest key from the hardware fingerprint', async () => {
    _resetZaniiForTesting()
    process.env.ZANII_PROOF = '1'
    delete process.env.ZANII_API_KEY
    process.env.ZANII_TEST_FINGERPRINT = 'deadbeefcafe1234'
    try {
      const account = await ensureZaniiAccount()
      expect(account).not.toBeNull()
      expect(account!.org_id).toBe(7)
      expect(account!.api_key).toBe('zk_live_test')
      expect(account!.hw_name).toBe(`zaniicode-${expectedFp}`)

      const signupCall = fetchCalls.find(c =>
        c.url.includes('/v1/account/signup'),
      )
      expect(signupCall?.body).toContain(`zaniicode-${expectedFp}`)
      const keyCall = fetchCalls.find(c => c.url.includes('/v1/account/keys'))
      expect(keyCall?.auth).toBe('Bearer zk_admin_test')

      // Persisted to the config home (mode 600 file)
      const stored = JSON.parse(
        readFileSync(join(tempHome, 'zanii-account.json'), 'utf-8'),
      )
      expect(stored.admin_key).toBe('zk_admin_test')
    } finally {
      delete process.env.ZANII_TEST_FINGERPRINT
    }
  })

  test('existing account short-circuits without another signup', async () => {
    const signupsBefore = fetchCalls.filter(c =>
      c.url.includes('/v1/account/signup'),
    ).length
    const account = await ensureZaniiAccount()
    expect(account?.api_key).toBe('zk_live_test')
    const signupsAfter = fetchCalls.filter(c =>
      c.url.includes('/v1/account/signup'),
    ).length
    expect(signupsAfter).toBe(signupsBefore)
  })

  test('tool call recording creates identity and reaches the ledger', async () => {
    process.env.ZANII_API_KEY = 'zk_live_env'
    try {
      zaniiRecordToolCall('Bash', false)
      // SDK batches receipts (default 300ms flush timer); allow it to fire
      await new Promise(resolve => setTimeout(resolve, 1200))
      const identityPath = join(tempHome, 'zanii-agent.json')
      const stored = JSON.parse(readFileSync(identityPath, 'utf-8'))
      expect(stored.agentDid.startsWith('did:key:')).toBe(true)
      expect(stored.cert.scopes).toEqual(['cli.*'])
      expect(fetchCalls.some(c => c.url.includes('/v1/head/'))).toBe(true)
    } finally {
      delete process.env.ZANII_API_KEY
    }
  })

  test('startup proof records a session receipt and verifies chain state', async () => {
    process.env.ZANII_PROOF = '1'
    // Proof route 404s → inclusion check unavailable → falls back to public
    // STH read, but the session receipt itself was still recorded.
    const status = await zaniiStartupProof()
    expect(['live', 'verified']).toContain(status.kind)
    if (status.kind === 'live') {
      expect(status.size).toBe(42)
      expect(status.root).toBe('abcdef12')
      expect(status.receipts).toBe(1234)
    }
    expect(fetchCalls.some(c => c.url.includes('/v1/session_start'))).toBe(
      false,
    )
    expect(fetchCalls.some(c => c.url.includes('/v1/sth'))).toBe(true)
  })
})
