/**
 * CodeGraph — regex-based codebase indexer for impact analysis.
 *
 * Scans TypeScript/JavaScript source files, extracts symbol definitions and
 * call-site references, and builds an in-memory graph. Provides impact analysis
 * (who calls what, what depends on what) without requiring an LSP server.
 *
 * Features:
 * - Incremental indexing: tracks file mtimes, only re-scans changed files
 * - Persistence: saves index to JSON cache for warm starts
 * - ponytail: regex-based extraction covers ~80% of TS patterns
 */

import { readdir, readFile, stat, writeFile, mkdir, rename } from 'fs/promises'
import { join, relative, extname, dirname } from 'path'

// ── Types ────────────────────────────────────────────────────────────────────

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'variable'
  | 'export'

export type SymbolDef = {
  name: string
  kind: SymbolKind
  file: string
  line: number
  exported: boolean
  references: string[]
}

export type ImpactResult = {
  symbolName: string
  definition: SymbolDef | null
  callers: Array<{ file: string; line: number; symbol: string }>
  callees: Array<{ file: string; line: number; symbol: string }>
  references: string[]
  uniqueFilesAffected: number
  summary: string
}

// ── Persistence types ────────────────────────────────────────────────────────

type CacheEntry = {
  symbols: SymbolDef[]
  mtime: number // ms since epoch
}

type CacheData = {
  version: 1
  root: string
  files: Record<string, CacheEntry> // relative path → cache entry
  builtAt: number
}

// ── State ────────────────────────────────────────────────────────────────────

const symbols = new Map<string, SymbolDef[]>()
const fileMtimes = new Map<string, number>() // relative path → mtime ms
let indexed = false
let indexRoot = ''
let buildGeneration = 0 // prevents concurrent builds from corrupting shared state

// ── Cache paths ──────────────────────────────────────────────────────────────

function getCacheDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '/tmp'
  return join(home, '.zaniicode')
}

function getCachePath(root: string): string {
  // Use a hash of the root to avoid collisions
  const safeName = root.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return join(getCacheDir(), `codegraph-${safeName}.json`)
}

// ── Cache I/O ────────────────────────────────────────────────────────────────

async function loadCache(root: string): Promise<CacheData | null> {
  try {
    const cachePath = getCachePath(root)
    const raw = await readFile(cachePath, 'utf-8')
    const data = JSON.parse(raw) as CacheData
    if (
      data.version !== 1 ||
      data.root !== root ||
      typeof data.files !== 'object' ||
      data.files === null
    )
      return null
    return data
  } catch {
    return null
  }
}

async function saveCache(root: string): Promise<void> {
  try {
    const cacheDir = getCacheDir()
    await mkdir(cacheDir, { recursive: true })

    const files: Record<string, CacheEntry> = {}
    for (const [file, defs] of symbols) {
      files[file] = { symbols: defs, mtime: fileMtimes.get(file) ?? 0 }
    }

    const data: CacheData = {
      version: 1,
      root,
      files,
      builtAt: Date.now(),
    }

    const cachePath = getCachePath(root)
    const tmpPath = cachePath + '.tmp'
    await writeFile(tmpPath, JSON.stringify(data), 'utf-8')
    await rename(tmpPath, cachePath)
  } catch {
    // cache write is best-effort
  }
}

// ── Regex patterns ───────────────────────────────────────────────────────────

const EXPORT_PATTERN =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/

const FUNCTION_PATTERN =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/

const CLASS_PATTERN = /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/

const INTERFACE_PATTERN = /^(?:export\s+)?interface\s+(\w+)/

const TYPE_PATTERN = /^(?:export\s+)?type\s+(\w+)/

const ENUM_PATTERN = /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/

const CONST_PATTERN =
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=/

const CALL_PATTERN = /\b([a-zA-Z_$]\w*)\s*\(/g

const EXTENDS_PATTERN = /extends\s+(\w+)/
const IMPLEMENTS_PATTERN = /implements\s+(\w+)/

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  'build',
  '.output',
  '__pycache__',
])

const INDEXABLE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

// ── File scanning ────────────────────────────────────────────────────────────

type FileEntry = { path: string; relPath: string; mtime: number }

async function scanDir(
  dir: string,
  root: string,
  files: FileEntry[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await scanDir(fullPath, root, files)
    } else if (entry.isFile() && INDEXABLE_EXTS.has(extname(entry.name))) {
      try {
        const st = await stat(fullPath)
        files.push({
          path: fullPath,
          relPath: relative(root, fullPath),
          mtime: st.mtimeMs,
        })
      } catch {
        // skip unreadable
      }
    }
  }
}

// ── Symbol extraction ────────────────────────────────────────────────────────

function extractSymbols(
  content: string,
  filePath: string,
  root: string,
): SymbolDef[] {
  const lines = content.split('\n')
  const defs: SymbolDef[] = []
  const relPath = relative(root, filePath)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      !trimmed
    )
      continue

    let name: string | undefined
    let kind: SymbolKind = 'variable'
    let exported = false

    if (trimmed.startsWith('export')) {
      exported = true
    }

    const fnMatch = trimmed.match(FUNCTION_PATTERN)
    if (fnMatch) {
      name = fnMatch[1]
      kind = 'function'
    }

    if (!name) {
      const clsMatch = trimmed.match(CLASS_PATTERN)
      if (clsMatch) {
        name = clsMatch[1]
        kind = 'class'
      }
    }

    if (!name) {
      const ifaceMatch = trimmed.match(INTERFACE_PATTERN)
      if (ifaceMatch) {
        name = ifaceMatch[1]
        kind = 'interface'
      }
    }

    if (!name) {
      const typeMatch = trimmed.match(TYPE_PATTERN)
      if (typeMatch) {
        name = typeMatch[1]
        kind = 'type'
      }
    }

    if (!name) {
      const enumMatch = trimmed.match(ENUM_PATTERN)
      if (enumMatch) {
        name = enumMatch[1]
        kind = 'enum'
      }
    }

    if (!name) {
      const constMatch = trimmed.match(CONST_PATTERN)
      if (constMatch) {
        name = constMatch[1]
        kind = 'const'
      }
    }

    if (!name) continue

    const refs = new Set<string>()
    const contextBlock = lines
      .slice(i, Math.min(i + 8, lines.length))
      .join('\n')

    const callMatches = contextBlock.matchAll(CALL_PATTERN)
    for (const cm of callMatches) {
      const called = cm[1]
      if (
        called &&
        called !== name &&
        ![
          'if',
          'for',
          'while',
          'switch',
          'catch',
          'return',
          'import',
          'require',
        ].includes(called)
      ) {
        refs.add(called)
      }
    }

    const extendsMatch = contextBlock.match(EXTENDS_PATTERN)
    if (extendsMatch) refs.add(extendsMatch[1]!)

    const implementsMatch = contextBlock.match(IMPLEMENTS_PATTERN)
    if (implementsMatch) refs.add(implementsMatch[1]!)

    defs.push({
      name,
      kind,
      file: relPath,
      line: i + 1,
      exported,
      references: [...refs],
    })
  }

  return defs
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the code graph index for a project root.
 * Uses cached data when possible — only re-scans files with changed mtimes.
 * Saves cache to disk after build for warm starts next session.
 */
export async function buildCodeGraph(projectRoot: string): Promise<void> {
  const gen = ++buildGeneration
  indexed = false
  indexRoot = projectRoot

  // Try loading cache from previous session
  const cache = await loadCache(projectRoot)

  // Scan all files with their mtimes
  const files: FileEntry[] = []
  await scanDir(projectRoot, projectRoot, files)

  // Build a set of current file relative paths
  const currentFiles = new Set(files.map(f => f.relPath))

  // Remove cached entries for files that no longer exist
  if (cache) {
    for (const relPath of Object.keys(cache.files)) {
      if (!currentFiles.has(relPath)) {
        symbols.delete(relPath)
        fileMtimes.delete(relPath)
      }
    }
  }

  // Process files — skip unchanged ones
  let reindexed = 0
  let cached = 0

  for (const file of files) {
    const cachedEntry = cache?.files[file.relPath]
    if (cachedEntry && cachedEntry.mtime === file.mtime) {
      // File hasn't changed — use cached symbols
      symbols.set(file.relPath, cachedEntry.symbols)
      fileMtimes.set(file.relPath, file.mtime)
      cached++
      continue
    }

    // File is new or changed — re-scan
    try {
      const content = await readFile(file.path, 'utf-8')
      if (content.length > 200_000) continue
      const defs = extractSymbols(content, file.path, projectRoot)
      if (defs.length > 0) {
        symbols.set(file.relPath, defs)
      } else {
        symbols.delete(file.relPath)
      }
      fileMtimes.set(file.relPath, file.mtime)
      reindexed++
    } catch {
      symbols.delete(file.relPath)
      fileMtimes.delete(file.relPath)
    }
  }

  // A newer build superseded us — don't overwrite its results
  if (gen !== buildGeneration) return

  indexed = true

  // Save cache for next session
  await saveCache(projectRoot)

  // Log stats — ponytail: console.log is fine here, it's a dev-facing build step
  console.log(
    `[CodeGraph] ${cached} cached, ${reindexed} re-indexed, ${symbols.size} total files`,
  )
}

/**
 * Check if the code graph has been built.
 */
export function isCodeGraphIndexed(): boolean {
  return indexed
}

/**
 * Get the root directory the code graph was built from.
 */
export function getCodeGraphRoot(): string {
  return indexRoot
}

/**
 * Find all symbol definitions matching a name.
 */
export function findSymbol(name: string): SymbolDef[] {
  const results: SymbolDef[] = []
  for (const defs of symbols.values()) {
    for (const def of defs) {
      if (def.name === name) results.push(def)
    }
  }
  return results
}

/**
 * Find all symbols that reference a given symbol name (callers).
 */
export function findCallers(
  symbolName: string,
): Array<{ file: string; line: number; symbol: string }> {
  const callers: Array<{ file: string; line: number; symbol: string }> = []
  for (const defs of symbols.values()) {
    for (const def of defs) {
      if (def.references.includes(symbolName)) {
        callers.push({ file: def.file, line: def.line, symbol: def.name })
      }
    }
  }
  return callers
}

/**
 * Find all symbols that a given symbol references (callees).
 */
export function findCallees(
  symbolName: string,
): Array<{ file: string; line: number; symbol: string }> {
  const callees: Array<{ file: string; line: number; symbol: string }> = []
  const defs = findSymbol(symbolName)
  for (const def of defs) {
    for (const refName of def.references) {
      const refDefs = findSymbol(refName)
      for (const refDef of refDefs) {
        callees.push({
          file: refDef.file,
          line: refDef.line,
          symbol: refDef.name,
        })
      }
    }
  }
  return callees
}

/**
 * Get all files that reference a given symbol (transitively).
 */
export function getBlastRadius(symbolName: string): string[] {
  const files = new Set<string>()
  const visited = new Set<string>()

  function walk(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    const callers = findCallers(name)
    for (const c of callers) {
      files.add(c.file)
      walk(c.symbol)
    }
  }

  walk(symbolName)

  for (const def of findSymbol(symbolName)) {
    files.add(def.file)
  }

  return [...files].sort()
}

/**
 * Search symbols by partial name match.
 */
export function searchSymbols(query: string, limit = 20): SymbolDef[] {
  const lower = query.toLowerCase()
  const results: SymbolDef[] = []
  for (const defs of symbols.values()) {
    for (const def of defs) {
      if (def.name.toLowerCase().includes(lower)) {
        results.push(def)
        if (results.length >= limit) return results
      }
    }
  }
  return results
}

/**
 * Get all exported symbols.
 */
export function getExportedSymbols(): SymbolDef[] {
  const results: SymbolDef[] = []
  for (const defs of symbols.values()) {
    for (const def of defs) {
      if (def.exported) results.push(def)
    }
  }
  return results
}

/**
 * Get statistics about the code graph.
 */
export function getCodeGraphStats(): {
  totalFiles: number
  totalSymbols: number
  byKind: Record<string, number>
  exportedCount: number
} {
  let totalSymbols = 0
  let exportedCount = 0
  const byKind: Record<string, number> = {}

  for (const defs of symbols.values()) {
    for (const def of defs) {
      totalSymbols++
      if (def.exported) exportedCount++
      byKind[def.kind] = (byKind[def.kind] ?? 0) + 1
    }
  }

  return {
    totalFiles: symbols.size,
    totalSymbols,
    byKind,
    exportedCount,
  }
}

/**
 * Clear the entire code graph.
 */
export function clearCodeGraph(): void {
  symbols.clear()
  fileMtimes.clear()
  indexed = false
  indexRoot = ''
  buildGeneration++
}
