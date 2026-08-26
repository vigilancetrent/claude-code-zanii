import {
  lstat,
  realpath,
  readFile,
  writeFile,
  mkdir,
  rename,
} from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { existsSync } from 'fs'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getErrnoCode } from '../utils/errors.js'
import { getAutoMemPath, isAutoMemoryEnabled } from './paths.js'
import { logError } from '../utils/log.js'

/**
 * Error thrown when a path validation detects a traversal or injection attempt.
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * Sanitize a file path key by rejecting dangerous patterns.
 * Checks for null bytes, URL-encoded traversals, and other injection vectors.
 * Returns the sanitized string or throws PathTraversalError.
 */
function sanitizePathKey(key: string): string {
  // Null bytes can truncate paths in C-based syscalls
  if (key.includes('\0')) {
    throw new PathTraversalError(`Null byte in path key: "${key}"`)
  }
  // URL-encoded traversals (e.g. %2e%2e%2f = ../)
  let decoded: string
  try {
    decoded = decodeURIComponent(key)
  } catch {
    // Malformed percent-encoding (e.g. %ZZ, lone %) — not valid URL-encoding,
    // so no URL-encoded traversal is possible
    decoded = key
  }
  if (decoded !== key && (decoded.includes('..') || decoded.includes('/'))) {
    throw new PathTraversalError(`URL-encoded traversal in path key: "${key}"`)
  }
  // Unicode normalization attacks: fullwidth ．．／ (U+FF0E U+FF0F) normalize
  // to ASCII ../ under NFKC. While path.resolve/fs.writeFile treat these as
  // literal bytes (not separators), downstream layers or filesystems may
  // normalize — reject for defense-in-depth (PSR M22187 vector 4).
  const normalized = key.normalize('NFKC')
  if (
    normalized !== key &&
    (normalized.includes('..') ||
      normalized.includes('/') ||
      normalized.includes('\\') ||
      normalized.includes('\0'))
  ) {
    throw new PathTraversalError(
      `Unicode-normalized traversal in path key: "${key}"`,
    )
  }
  // Reject backslashes (Windows path separator used as traversal vector)
  if (key.includes('\\')) {
    throw new PathTraversalError(`Backslash in path key: "${key}"`)
  }
  // Reject absolute paths
  if (key.startsWith('/')) {
    throw new PathTraversalError(`Absolute path key: "${key}"`)
  }
  return key
}

/**
 * Whether team memory features are enabled.
 * Team memory is a subdirectory of auto memory, so it requires auto memory
 * to be enabled. This keeps all team-memory consumers (prompt, content
 * injection, sync watcher, file detection) consistent when auto memory is
 * disabled via env var or settings.
 */
export function isTeamMemoryEnabled(): boolean {
  if (!isAutoMemoryEnabled()) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_herring_clock', false)
}

/**
 * Returns the team memory path: <memoryBase>/projects/<sanitized-project-root>/memory/team/
 * Lives as a subdirectory of the auto-memory directory, scoped per-project.
 */
export function getTeamMemPath(): string {
  return (join(getAutoMemPath(), 'team') + sep).normalize('NFC')
}

/**
 * Returns the team memory entrypoint: <memoryBase>/projects/<sanitized-project-root>/memory/team/MEMORY.md
 * Lives as a subdirectory of the auto-memory directory, scoped per-project.
 */
export function getTeamMemEntrypoint(): string {
  return join(getAutoMemPath(), 'team', 'MEMORY.md')
}

/**
 * Resolve symlinks for the deepest existing ancestor of a path.
 * The target file may not exist yet (we may be about to create it), so we
 * walk up the directory tree until realpath() succeeds, then rejoin the
 * non-existing tail onto the resolved ancestor.
 *
 * SECURITY (PSR M22186): path.resolve() does NOT resolve symlinks. An attacker
 * who can place a symlink inside teamDir pointing outside (e.g. to
 * ~/.ssh/authorized_keys) would pass a resolve()-based containment check.
 * Using realpath() on the deepest existing ancestor ensures we compare the
 * actual filesystem location, not the symbolic path.
 *
 */
async function realpathDeepestExisting(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = absolutePath
  // Walk up until realpath succeeds. ENOENT means this segment doesn't exist
  // yet; pop it onto the tail and try the parent. ENOTDIR means a non-directory
  // component sits in the middle of the path; pop and retry so we can realpath
  // the ancestor to detect symlink escapes.
  // Loop terminates when we reach the filesystem root (dirname('/') === '/').
  for (
    let parent = dirname(current);
    current !== parent;
    parent = dirname(current)
  ) {
    try {
      const realCurrent = await realpath(current)
      // Rejoin the non-existing tail in reverse order (deepest popped first)
      return tail.length === 0
        ? realCurrent
        : join(realCurrent, ...tail.reverse())
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        // Could be truly non-existent (safe to walk up) OR a dangling symlink
        // whose target doesn't exist. Dangling symlinks are an attack vector:
        // writeFile would follow the link and create the target outside teamDir.
        // lstat distinguishes: it succeeds for dangling symlinks (the link entry
        // itself exists), fails with ENOENT for truly non-existent paths.
        try {
          const st = await lstat(current)
          if (st.isSymbolicLink()) {
            throw new PathTraversalError(
              `Dangling symlink detected (target does not exist): "${current}"`,
            )
          }
          // lstat succeeded but isn't a symlink — ENOENT from realpath was
          // caused by a dangling symlink in an ancestor. Walk up to find it.
        } catch (lstatErr: unknown) {
          if (lstatErr instanceof PathTraversalError) {
            throw lstatErr
          }
          // lstat also failed (truly non-existent or inaccessible) — safe to walk up.
        }
      } else if (code === 'ELOOP') {
        // Symlink loop — corrupted or malicious filesystem state.
        throw new PathTraversalError(
          `Symlink loop detected in path: "${current}"`,
        )
      } else if (code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') {
        // EACCES, EIO, etc. — cannot verify containment. Fail closed by wrapping
        // as PathTraversalError so the caller can skip this entry gracefully
        // instead of aborting the entire batch.
        throw new PathTraversalError(
          `Cannot verify path containment (${code}): "${current}"`,
        )
      }
      tail.push(current.slice(parent.length + sep.length))
      current = parent
    }
  }
  // Reached filesystem root without finding an existing ancestor (rare —
  // root normally exists). Fall back to the input; containment check will reject.
  return absolutePath
}

/**
 * Check whether a real (symlink-resolved) path is within the real team
 * memory directory. Both sides are realpath'd so the comparison is between
 * canonical filesystem locations.
 *
 * If teamDir does not exist, returns true (skips the check). This is safe:
 * a symlink escape requires a pre-existing symlink inside teamDir, which
 * requires teamDir to exist. If there's no directory, there's no symlink,
 * and the first-pass string-level containment check is sufficient.
 */
async function isRealPathWithinTeamDir(
  realCandidate: string,
): Promise<boolean> {
  let realTeamDir: string
  try {
    // getTeamMemPath() includes a trailing separator; strip it because
    // realpath() rejects trailing separators on some platforms.
    realTeamDir = await realpath(getTeamMemPath().replace(/[/\\]+$/, ''))
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      // Team dir doesn't exist — symlink escape impossible, skip check.
      return true
    }
    // Unexpected error (EACCES, EIO) — fail closed.
    return false
  }
  if (realCandidate === realTeamDir) {
    return true
  }
  // Prefix-attack protection: require separator after the prefix so that
  // "/foo/team-evil" doesn't match "/foo/team".
  return realCandidate.startsWith(realTeamDir + sep)
}

/**
 * Check if a resolved absolute path is within the team memory directory.
 * Uses path.resolve() to convert relative paths and eliminate traversal segments.
 * Does NOT resolve symlinks — for write validation use validateTeamMemWritePath()
 * or validateTeamMemKey() which include symlink resolution.
 */
export function isTeamMemPath(filePath: string): boolean {
  // SECURITY: resolve() converts to absolute and eliminates .. segments,
  // preventing path traversal attacks (e.g. "team/../../etc/passwd")
  const resolvedPath = resolve(filePath)
  const teamDir = getTeamMemPath()
  return resolvedPath.startsWith(teamDir)
}

/**
 * Validate that an absolute file path is safe for writing to the team memory directory.
 * Returns the resolved absolute path if valid.
 * Throws PathTraversalError if the path contains injection vectors, escapes the
 * directory via .. segments, or escapes via a symlink (PSR M22186).
 */
export async function validateTeamMemWritePath(
  filePath: string,
): Promise<string> {
  if (filePath.includes('\0')) {
    throw new PathTraversalError(`Null byte in path: "${filePath}"`)
  }
  // First pass: normalize .. segments and check string-level containment.
  // This is a fast rejection for obvious traversal attempts before we touch
  // the filesystem.
  const resolvedPath = resolve(filePath)
  const teamDir = getTeamMemPath()
  // Prefix attack protection: teamDir already ends with sep (from getTeamMemPath),
  // so "team-evil/" won't match "team/"
  if (!resolvedPath.startsWith(teamDir)) {
    throw new PathTraversalError(
      `Path escapes team memory directory: "${filePath}"`,
    )
  }
  // Second pass: resolve symlinks on the deepest existing ancestor and verify
  // the real path is still within the real team dir. This catches symlink-based
  // escapes that path.resolve() alone cannot detect.
  const realPath = await realpathDeepestExisting(resolvedPath)
  if (!(await isRealPathWithinTeamDir(realPath))) {
    throw new PathTraversalError(
      `Path escapes team memory directory via symlink: "${filePath}"`,
    )
  }
  return resolvedPath
}

/**
 * Validate a relative path key from the server against the team memory directory.
 * Sanitizes the key, joins with the team dir, resolves symlinks on the deepest
 * existing ancestor, and verifies containment against the real team dir.
 * Returns the resolved absolute path.
 * Throws PathTraversalError if the key is malicious (PSR M22186).
 */
export async function validateTeamMemKey(relativeKey: string): Promise<string> {
  sanitizePathKey(relativeKey)
  const teamDir = getTeamMemPath()
  const fullPath = join(teamDir, relativeKey)
  // First pass: normalize .. segments and check string-level containment.
  const resolvedPath = resolve(fullPath)
  if (!resolvedPath.startsWith(teamDir)) {
    throw new PathTraversalError(
      `Key escapes team memory directory: "${relativeKey}"`,
    )
  }
  // Second pass: resolve symlinks and verify real containment.
  const realPath = await realpathDeepestExisting(resolvedPath)
  if (!(await isRealPathWithinTeamDir(realPath))) {
    throw new PathTraversalError(
      `Key escapes team memory directory via symlink: "${relativeKey}"`,
    )
  }
  return resolvedPath
}

/**
 * Check if a file path is within the team memory directory
 * and team memory is enabled.
 */
export function isTeamMemFile(filePath: string): boolean {
  return isTeamMemoryEnabled() && isTeamMemPath(filePath)
}

// ── Agent Registry & ACL ─────────────────────────────────────────────────────

export type AgentRole = 'admin' | 'editor' | 'viewer'

export type AgentConfig = {
  id: string
  name: string
  role: AgentRole
  readScopes: string[]
  writeScopes: string[]
  maxEntries?: number
}

type AgentRegistryData = {
  version: 1
  agents: Record<string, AgentConfig>
}

const agentRegistry = new Map<string, AgentConfig>()

function getRegistryPath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '/tmp'
  return join(home, '.zaniicode', 'agent-registry.json')
}

async function loadRegistry(): Promise<void> {
  try {
    const raw = await readFile(getRegistryPath(), 'utf-8')
    const data = JSON.parse(raw) as AgentRegistryData
    if (data.version !== 1) return
    for (const [id, config] of Object.entries(data.agents)) {
      agentRegistry.set(id, config)
    }
  } catch (e: unknown) {
    if (existsSync(getRegistryPath())) {
      logError(
        `Agent registry file is corrupt, resetting: ${e instanceof Error ? e.message : e}`,
      )
    }
  }
}

async function saveRegistry(): Promise<void> {
  try {
    const registryDir = dirname(getRegistryPath())
    await mkdir(registryDir, { recursive: true })
    const data: AgentRegistryData = {
      version: 1,
      agents: Object.fromEntries(agentRegistry),
    }
    const registryPath = getRegistryPath()
    const tmpPath = registryPath + '.tmp'
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await rename(tmpPath, registryPath)
  } catch {
    // best-effort
  }
}

/**
 * Register an agent with its role and access scopes.
 * Persists to disk automatically.
 */
export async function registerAgent(config: AgentConfig): Promise<void> {
  agentRegistry.set(config.id, config)
  await saveRegistry()
}

/**
 * Get an agent's config by ID.
 */
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agentRegistry.get(agentId)
}

/**
 * Get the current agent's ID from env or config.
 */
export function getCurrentAgentId(): string {
  return process.env.CCZ_TEAMMEM_AGENT_ID ?? ''
}

/**
 * Get the current agent's role for team memory filtering.
 */
export function getTeamMemAgentRole(): string {
  return process.env.CCZ_TEAMMEM_AGENT_ROLE ?? ''
}

/**
 * Get the current agent's full config.
 */
export function getCurrentAgentConfig(): AgentConfig | undefined {
  const id = getCurrentAgentId()
  if (!id) return undefined
  return agentRegistry.get(id)
}

/**
 * Check if an agent has write access to a given scope.
 */
export function canAgentWrite(agentId: string, scope: string): boolean {
  const config = agentRegistry.get(agentId)
  if (!config) return true
  if (config.role === 'admin') return true
  return config.writeScopes.includes(scope) || config.writeScopes.includes('*')
}

/**
 * Check if an agent has read access to a given scope.
 */
export function canAgentRead(agentId: string, scope: string): boolean {
  const config = agentRegistry.get(agentId)
  if (!config) return true
  return config.readScopes.includes(scope) || config.readScopes.includes('*')
}

/**
 * Check if an entry is accessible to the current agent based on its roles.
 */
export function isEntryVisibleToAgent(
  entryRoles: string[] | undefined,
  agentRole: string,
): boolean {
  if (!agentRole) return true
  if (!entryRoles || entryRoles.length === 0) return true
  return entryRoles.includes(agentRole)
}

/**
 * Filter entries by role. Returns only entries the agent can see.
 */
export function filterEntriesByRole<T>(
  entries: Record<string, T>,
  meta: Record<string, { roles?: string[] }> | undefined,
): Record<string, T> {
  const agentRole = getTeamMemAgentRole()
  if (!agentRole) return entries

  const filtered: Record<string, T> = {}
  for (const [key, value] of Object.entries(entries)) {
    const entryMeta = meta?.[key]
    if (isEntryVisibleToAgent(entryMeta?.roles, agentRole)) {
      filtered[key] = value
    }
  }
  return filtered
}

/**
 * Filter entries by ACL (agent scopes + role + maxEntries). Returns only entries the agent can see.
 * Combines scope-based, role-based, and budget-based filtering.
 */
export function filterEntriesByACL<T>(
  entries: Record<string, T>,
  meta: Record<string, { roles?: string[]; scope?: string }> | undefined,
): Record<string, T> {
  const agentId = getCurrentAgentId()
  const agentRole = getTeamMemAgentRole()
  const agentConfig = agentId ? agentRegistry.get(agentId) : undefined

  if (!agentId && !agentRole) return entries

  const filtered: Record<string, T> = {}
  for (const [key, value] of Object.entries(entries)) {
    const entryMeta = meta?.[key]
    const scope = entryMeta?.scope ?? '*'

    // Scope check
    if (agentConfig && !canAgentRead(agentId, scope)) continue

    // Role check
    if (agentRole && !isEntryVisibleToAgent(entryMeta?.roles, agentRole))
      continue

    filtered[key] = value
  }

  // Enforce maxEntries budget after ACL — apply on visible entries only
  const maxEntries = agentConfig?.maxEntries
  if (maxEntries && Object.keys(filtered).length > maxEntries) {
    const sorted = Object.keys(filtered).sort()
    for (const key of sorted.slice(maxEntries)) {
      delete filtered[key]
    }
  }

  return filtered
}

/**
 * List all registered agents.
 */
export function listAgents(): AgentConfig[] {
  return [...agentRegistry.values()]
}

/**
 * Clear the agent registry.
 */
export async function clearAgentRegistry(): Promise<void> {
  agentRegistry.clear()
  await saveRegistry()
}

/**
 * Load the agent registry from disk. Call on startup.
 */
export async function initAgentRegistry(): Promise<void> {
  await loadRegistry()
}
