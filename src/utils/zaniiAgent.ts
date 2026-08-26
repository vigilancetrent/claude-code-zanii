import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces, platform } from 'node:os'
import { join } from 'node:path'
import { feature } from 'bun:bundle'
import {
  createCert,
  fetchAndVerifyProof,
  generateKeypair,
  ZaniiAgent,
  type DelegationCert,
} from '@zanii/sdk'
import { getClaudeConfigHomeDir } from './envUtils.js'

const DEFAULT_SERVER = 'https://ledger.zanii.agency'
const CERT_EXP = '2036-01-01T00:00:00Z'
const FETCH_TIMEOUT_MS = 5000

export type ZaniiStartupStatus =
  | { kind: 'off' }
  | { kind: 'live'; size: number; root: string; receipts?: number }
  | { kind: 'verified'; index?: number; size: number; root: string }

export function isZaniiEnabled(): boolean {
  if (process.env.ZANII_PROOF === '0') return false
  if (feature('ZANII_PROOF')) return true
  return process.env.ZANII_PROOF === '1'
}

function zaniiServerUrl(): string {
  return process.env.ZANII_SERVER_URL ?? DEFAULT_SERVER
}

interface StoredIdentity {
  ownerDid: string
  ownerPrivateKeyHex: string
  agentDid: string
  agentPrivateKeyHex: string
  cert: DelegationCert
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

let cachedIdentity: StoredIdentity | null | undefined
let cachedAccount: StoredAccount | null | undefined
let cachedFingerprint: string | null | undefined

/** Test hook: clears all module-level caches. */
export function _resetZaniiForTesting(): void {
  cachedIdentity = undefined
  cachedAccount = undefined
  cachedFingerprint = undefined
  cachedAgent = undefined
}

function identityFilePath(): string {
  return join(getClaudeConfigHomeDir(), 'zanii-agent.json')
}

function loadOrCreateIdentity(): StoredIdentity | null {
  if (cachedIdentity !== undefined) return cachedIdentity
  try {
    const path = identityFilePath()
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredIdentity
      if (
        parsed.agentDid &&
        parsed.agentPrivateKeyHex &&
        parsed.ownerDid &&
        parsed.ownerPrivateKeyHex &&
        parsed.cert
      ) {
        cachedIdentity = parsed
        return parsed
      }
    }
    const owner = generateKeypair()
    const agent = generateKeypair()
    const cert = createCert(
      {
        issuer: owner.did,
        subject: agent.did,
        scopes: ['cli.*'],
        exp: CERT_EXP,
      },
      owner.privateKey,
    )
    const stored: StoredIdentity = {
      ownerDid: owner.did,
      ownerPrivateKeyHex: toHex(owner.privateKey),
      agentDid: agent.did,
      agentPrivateKeyHex: toHex(agent.privateKey),
      cert,
    }
    mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
    writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 })
    cachedIdentity = stored
    return stored
  } catch {
    cachedIdentity = null
    return null
  }
}

let cachedAgent: ZaniiAgent | undefined

function getAgent(): ZaniiAgent | null {
  const apiKey = resolveApiKey()
  if (!apiKey) return null
  if (cachedAgent) return cachedAgent
  const identity = loadOrCreateIdentity()
  if (!identity) return null
  cachedAgent = new ZaniiAgent({
    serverUrl: zaniiServerUrl(),
    agentDid: identity.agentDid,
    agentPrivateKey: fromHex(identity.agentPrivateKeyHex),
    delegation: [identity.cert],
    apiKey,
  })
  return cachedAgent
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

interface SthResponse {
  size: number
  root: string
}

interface StatsResponse {
  receipts: number
}

function shortRoot(root: string): string {
  return root.replace(/^sha256:/, '').slice(0, 8)
}

/**
 * Startup proof: with an API key, record a session_start receipt and fully
 * verify its Merkle inclusion client-side. Otherwise fall back to a public
 * read of the log's signed tree head. Never throws.
 */
export async function zaniiStartupProof(): Promise<ZaniiStartupStatus> {
  if (!isZaniiEnabled()) return { kind: 'off' }
  const server = zaniiServerUrl()
  try {
    // Self-provision an ingest key from hardware identity on first launch
    await ensureZaniiAccount()
    const agent = getAgent()
    if (agent) {
      const version = typeof MACRO !== 'undefined' ? MACRO.VERSION : 'unknown'
      const { hash } = await agent.record({
        action: 'session_start',
        target: 'cli.session',
        payload: { version },
      })
      await agent.flush()
      const proof = await fetchAndVerifyProof(server, hash)
      if (proof.ok && proof.sth) {
        return {
          kind: 'verified',
          size: proof.sth.size,
          root: shortRoot(proof.sth.root),
        }
      }
    }
    const sth = await fetchJson<SthResponse>(`${server}/v1/sth`)
    let receipts: number | undefined
    try {
      receipts = (await fetchJson<StatsResponse>(`${server}/v1/stats`)).receipts
    } catch {
      receipts = undefined
    }
    return { kind: 'live', size: sth.size, root: shortRoot(sth.root), receipts }
  } catch {
    return { kind: 'off' }
  }
}

/**
 * Fire-and-forget receipt for one tool call. Hash-only payload — the tool
 * name is hashed into payload_hash and never stored in the clear on the log.
 * No-op without an API key or when offline.
 */
export function zaniiRecordToolCall(toolName: string, isError: boolean): void {
  if (!isZaniiEnabled()) return
  if (!resolveApiKey()) return
  void (async () => {
    const agent = getAgent()
    if (!agent) return
    await agent.record({
      action: isError ? 'tool_error' : 'tool_call',
      target: `cli.tool.${toolName}`,
      payload: { ok: !isError },
    })
  })().catch(() => {})
}

/**
 * Fire-and-forget receipt for a memory write. Hashes the content and
 * records store/key/source so memory provenance is auditable.
 * No-op without an API key or when offline.
 */
export function zaniiRecordMemoryWrite(
  store: string,
  key: string,
  content: string,
  source: 'session' | 'user' | 'agent',
): void {
  if (!isZaniiEnabled()) return
  if (!resolveApiKey()) return
  void (async () => {
    const agent = getAgent()
    if (!agent) return
    const contentHash = createHash('sha256')
      .update(content)
      .digest('hex')
      .slice(0, 16)
    await agent.record({
      action: 'memory_write',
      target: `cli.memory.${store}.${key}`,
      payload: { contentHash, source, contentLength: content.length },
    })
  })().catch(() => {})
}

// ── Hardware fingerprint & self-serve account provisioning ──────────────────

function runCommand(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      timeout: 3000,
      encoding: 'utf-8',
      windowsHide: true,
    })
  } catch {
    return null
  }
}

function macAddressFallback(): string | null {
  const macs = Object.values(networkInterfaces())
    .flat()
    .filter(i => i && !i.internal && i.mac !== '00:00:00:00:00:00')
    .map(i => i!.mac)
    .sort()
  return macs.length > 0 ? macs.join(',') : null
}

/**
 * Stable per-machine identifier. Prefers the SMBIOS product UUID (set at
 * manufacture — survives OS reinstalls), falling back to OS machine IDs and
 * finally NIC MAC addresses.
 */
function hardwareFingerprint(): string | null {
  if (cachedFingerprint !== undefined) return cachedFingerprint
  let raw: string | null = null
  try {
    if (process.env.ZANII_TEST_FINGERPRINT) {
      raw = process.env.ZANII_TEST_FINGERPRINT
    } else if (platform() === 'win32') {
      // SMBIOS UUID first; MachineGuid only as a last resort (it rotates on reinstall)
      const wmic = runCommand('wmic', ['csproduct', 'get', 'uuid'])
      if (wmic) {
        const uuid = wmic
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && l.toLowerCase() !== 'uuid')[0]
        raw = uuid ?? null
      }
      if (!raw) {
        const reg = runCommand('reg', [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid',
        ])
        if (reg) {
          const match = reg.match(/MachineGuid\s+REG_SZ\s+(\S+)/)
          raw = match ? match[1] : null
        }
      }
      if (!raw) raw = macAddressFallback()
    } else if (platform() === 'darwin') {
      const out = runCommand('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      if (out) {
        const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
        raw = match ? match[1] : null
      }
      if (!raw) raw = macAddressFallback()
    } else {
      for (const p of ['/sys/class/dmi/id/product_uuid', '/etc/machine-id']) {
        try {
          const v = readFileSync(p, 'utf-8').trim()
          if (v) {
            raw = v
            break
          }
        } catch {
          // try next source
        }
      }
      if (!raw) raw = macAddressFallback()
    }
    cachedFingerprint = raw
      ? createHash('sha256').update(raw).digest('hex').slice(0, 12)
      : null
    return cachedFingerprint
  } catch {
    cachedFingerprint = null
    return null
  }
}

interface StoredAccount {
  org_id: number
  admin_key: string
  api_key: string
  hw_name: string
  created_at: string
}

function accountFilePath(): string {
  return join(getClaudeConfigHomeDir(), 'zanii-account.json')
}

function loadAccount(): StoredAccount | null {
  if (cachedAccount !== undefined) return cachedAccount
  try {
    const path = accountFilePath()
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredAccount
      if (parsed.org_id && parsed.admin_key && parsed.api_key) {
        cachedAccount = parsed
        return parsed
      }
    }
  } catch {
    // corrupt file → re-provision below
  }
  cachedAccount = null
  return null
}

async function postJson<T>(
  url: string,
  body: unknown,
  bearer?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

interface SignupResponse {
  org_id: number
  admin_key: string
}

interface KeyResponse {
  api_key: string
}

/**
 * Self-serve account provisioning. On first launch (or after the config home
 * is wiped) this signs up a Zanii org named after the hardware fingerprint,
 * issues a `zk_live_` ingest key, and persists both under .zaniicode/. The
 * admin key plays the role of a password — there is no email login in the API.
 * Idempotent; silent failure just defers to the next launch.
 */
export async function ensureZaniiAccount(): Promise<StoredAccount | null> {
  const existing = loadAccount()
  if (existing) return existing
  const fp = hardwareFingerprint()
  if (!fp) return null
  mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
  const baseName = `zaniicode-${fp}`
  const server = zaniiServerUrl()

  let signup: SignupResponse
  try {
    signup = await postJson<SignupResponse>(`${server}/v1/account/signup`, {
      name: baseName,
    })
  } catch {
    // Name may already be registered from a previous config-home wipe —
    // fall back to a unique suffixed name so provisioning always succeeds.
    try {
      const suffix = createHash('sha256')
        .update(`${fp}:${Date.now()}`)
        .digest('hex')
        .slice(0, 6)
      signup = await postJson<SignupResponse>(`${server}/v1/account/signup`, {
        name: `${baseName}-${suffix}`,
      })
    } catch {
      return null
    }
  }

  try {
    const key = await postJson<KeyResponse>(
      `${server}/v1/account/keys`,
      { label: 'zaniicode-cli' },
      signup.admin_key,
    )
    const account: StoredAccount = {
      org_id: signup.org_id,
      admin_key: signup.admin_key,
      api_key: key.api_key,
      hw_name: baseName,
      created_at: new Date().toISOString(),
    }
    writeFileSync(accountFilePath(), JSON.stringify(account, null, 2), {
      mode: 0o600,
    })
    cachedAccount = account
    return account
  } catch {
    return null
  }
}

/** Env key wins (power users); otherwise the auto-provisioned ingest key. */
function resolveApiKey(): string | null {
  if (process.env.ZANII_API_KEY) return process.env.ZANII_API_KEY
  return loadAccount()?.api_key ?? null
}
