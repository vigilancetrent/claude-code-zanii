import {
  buildCodeGraph,
  getExportedSymbols,
  isCodeGraphIndexed,
} from '../services/CodeGraph/index.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'

// ~1.5k tokens: enough to orient the model, cheap enough to keep in the
// prompt every turn. Aider's repo-map budget is in the same range.
const MAX_CHARS = 6000
const MAX_FILES = 60
const MAX_SYMBOLS_PER_FILE = 8

let buildStarted = false

/**
 * Ranked map of exported symbols per file from the CodeGraph. Files with
 * the most inbound references come first (the same signal Aider ranks on).
 * Returns null until the graph is indexed; kicks off the build once.
 */
export function getRepoMapSection(): string | null {
  if (!isCodeGraphIndexed()) {
    if (!buildStarted) {
      buildStarted = true
      void buildCodeGraph(getCwd()).catch(err =>
        logForDebugging(`[repoMap] CodeGraph build failed: ${err}`),
      )
    }
    return null
  }
  const byFile = new Map<string, { refs: number; symbols: string[] }>()
  for (const s of getExportedSymbols()) {
    const entry = byFile.get(s.file) ?? { refs: 0, symbols: [] }
    entry.refs += s.references.length
    if (entry.symbols.length < MAX_SYMBOLS_PER_FILE) {
      entry.symbols.push(`${s.name}${s.kind === 'function' ? '()' : ''}`)
    }
    byFile.set(s.file, entry)
  }
  if (byFile.size === 0) return null
  const lines: string[] = []
  let chars = 0
  for (const [file, { symbols }] of [...byFile.entries()]
    .sort((a, b) => b[1].refs - a[1].refs)
    .slice(0, MAX_FILES)) {
    const line = `${file}: ${symbols.join(', ')}`
    if (chars + line.length > MAX_CHARS) break
    lines.push(line)
    chars += line.length + 1
  }
  return [
    '# Repository map',
    'Exported symbols per file, most-referenced first. Use it to pick where to look; it is a map, not the code.',
    ...lines,
  ].join('\n')
}
