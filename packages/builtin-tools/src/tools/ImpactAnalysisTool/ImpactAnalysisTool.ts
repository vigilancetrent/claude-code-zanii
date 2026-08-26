import { open } from 'fs/promises'
import * as path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  Location,
  LocationLink,
} from 'vscode-languageserver-types'
import { z } from 'zod/v4'
import {
  getLspServerManager,
  isLspConnected,
  waitForInitialization,
} from 'src/services/lsp/manager.js'
import {
  buildCodeGraph,
  isCodeGraphIndexed,
  findSymbol,
  findCallers,
  findCallees,
  getBlastRadius,
  getCodeGraphRoot,
} from 'src/services/CodeGraph/index.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { toError } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { expandPath } from 'src/utils/path.js'
import { checkReadPermissionForTool } from 'src/utils/permissions/filesystem.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { IMPACT_ANALYSIS_TOOL_NAME, DESCRIPTION } from './prompt.js'

// ── Schemas ──────────────────────────────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    filePath: z.string().describe('Absolute or relative path to the file'),
    line: z
      .number()
      .int()
      .positive()
      .describe('Line number (1-based, as shown in editors)'),
    character: z
      .number()
      .int()
      .positive()
      .describe('Character offset (1-based, as shown in editors)'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const impactEntry = z.object({
  file: z.string(),
  line: z.number().int(),
  symbol: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    symbolName: z.string().optional(),
    callers: z.array(impactEntry).optional(),
    callees: z.array(impactEntry).optional(),
    references: z.array(z.string()).optional(),
    uniqueFilesAffected: z.number().int(),
    summary: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// ── Helpers ──────────────────────────────────────────────────────────────────

function toAbsolute(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
}

function toLocation(item: Location | LocationLink): Location {
  if ('targetUri' in item) {
    return { uri: item.targetUri, range: item.targetRange }
  }
  return item as Location
}

function locationToFileLine(
  loc: Location,
  cwd: string,
): { file: string; line: number } {
  const filePath = fileURLToPath(loc.uri)
  const rel = path.relative(cwd, filePath)
  return { file: rel, line: loc.range.start.line + 1 }
}

function groupCallersByFile(
  calls: CallHierarchyIncomingCall[],
  cwd: string,
): Array<{ file: string; line: number; symbol?: string }> {
  const entries: Array<{ file: string; line: number; symbol?: string }> = []
  for (const call of calls) {
    const from = call.from
    if (!from?.name) continue
    const uri = from.uri
    if (!uri) continue
    const rel = path.relative(cwd, fileURLToPath(uri))
    entries.push({
      file: rel,
      line: from.range.start.line + 1,
      symbol: from.name,
    })
  }
  return entries
}

function groupCalleesByFile(
  calls: CallHierarchyOutgoingCall[],
  cwd: string,
): Array<{ file: string; line: number; symbol?: string }> {
  const entries: Array<{ file: string; line: number; symbol?: string }> = []
  for (const call of calls) {
    const to = call.to
    if (!to?.name) continue
    const uri = to.uri
    if (!uri) continue
    const rel = path.relative(cwd, fileURLToPath(uri))
    entries.push({
      file: rel,
      line: to.range.start.line + 1,
      symbol: to.name,
    })
  }
  return entries
}

function groupReferencesByFile(locations: Location[], cwd: string): string[] {
  const files = new Set<string>()
  for (const loc of locations) {
    if (!loc.uri) continue
    const rel = path.relative(cwd, fileURLToPath(loc.uri))
    files.add(rel)
  }
  return [...files].sort()
}

// ── LSP path ─────────────────────────────────────────────────────────────────

async function callViaLsp(input: Input, cwd: string, absolutePath: string) {
  const manager = getLspServerManager()
  if (!manager) {
    return {
      data: {
        uniqueFilesAffected: 0,
        summary: 'LSP server manager not available.',
      },
    }
  }

  await waitForInitialization()

  const uri = pathToFileURL(absolutePath).href
  const position = { line: input.line - 1, character: input.character - 1 }

  if (!manager.isFileOpen(absolutePath)) {
    const handle = await open(absolutePath, 'r')
    try {
      const fileContent = await handle.readFile({ encoding: 'utf-8' })
      await manager.openFile(absolutePath, fileContent)
    } finally {
      await handle.close()
    }
  }

  // ── Step 1: Prepare call hierarchy ──
  let callItem: CallHierarchyItem | null = null
  let symbolName: string | undefined

  try {
    const prepareResult = await manager.sendRequest(
      absolutePath,
      'textDocument/prepareCallHierarchy',
      { textDocument: { uri }, position },
    )
    if (
      prepareResult &&
      Array.isArray(prepareResult) &&
      prepareResult.length > 0
    ) {
      callItem = prepareResult[0] as CallHierarchyItem
      symbolName = callItem?.name
    }
  } catch {
    // Call hierarchy not supported — continue with references only
  }

  // ── Step 2: Incoming calls (callers) ──
  let callers: Array<{ file: string; line: number; symbol?: string }> = []
  if (callItem) {
    try {
      const incomingResult = await manager.sendRequest(
        absolutePath,
        'callHierarchy/incomingCalls',
        { item: callItem },
      )
      if (incomingResult && Array.isArray(incomingResult)) {
        callers = groupCallersByFile(
          incomingResult as CallHierarchyIncomingCall[],
          cwd,
        )
      }
    } catch {
      // ignore
    }
  }

  // ── Step 3: Outgoing calls (callees) ──
  let callees: Array<{ file: string; line: number; symbol?: string }> = []
  if (callItem) {
    try {
      const outgoingResult = await manager.sendRequest(
        absolutePath,
        'callHierarchy/outgoingCalls',
        { item: callItem },
      )
      if (outgoingResult && Array.isArray(outgoingResult)) {
        callees = groupCalleesByFile(
          outgoingResult as CallHierarchyOutgoingCall[],
          cwd,
        )
      }
    } catch {
      // ignore
    }
  }

  // ── Step 4: Find references ──
  let referenceFiles: string[] = []
  let referenceCount = 0
  try {
    const refsResult = await manager.sendRequest(
      absolutePath,
      'textDocument/references',
      {
        textDocument: { uri },
        position,
        context: { includeDeclaration: true },
      },
    )
    if (refsResult && Array.isArray(refsResult)) {
      referenceCount = (refsResult as Location[]).length
      referenceFiles = groupReferencesByFile(refsResult as Location[], cwd)
    }
  } catch {
    // ignore
  }

  // ── Step 5: Compute blast radius ──
  const allFiles = new Set<string>()
  for (const c of callers) allFiles.add(c.file)
  for (const c of callees) allFiles.add(c.file)
  for (const f of referenceFiles) allFiles.add(f)
  allFiles.add(path.relative(cwd, absolutePath))

  const relTarget = path.relative(cwd, absolutePath)
  const summary = [
    `[LSP] Impact analysis for ${symbolName ?? 'symbol'} in ${relTarget}:`,
    `  ${callers.length} caller(s) across ${new Set(callers.map(c => c.file)).size} file(s)`,
    `  ${callees.length} callee(s) across ${new Set(callees.map(c => c.file)).size} file(s)`,
    `  ${referenceCount} reference(s) across ${referenceFiles.length} file(s)`,
    `  ${allFiles.size} unique file(s) affected total`,
    '',
    callers.length > 0
      ? `⚠️  Changing this symbol may break ${callers.length} call site(s).`
      : '✅ No callers found — safe to change signature.',
  ].join('\n')

  return {
    data: {
      symbolName,
      callers: callers.length > 0 ? callers : undefined,
      callees: callees.length > 0 ? callees : undefined,
      references: referenceFiles.length > 0 ? referenceFiles : undefined,
      uniqueFilesAffected: allFiles.size,
      summary,
    },
  }
}

// ── CodeGraph path ───────────────────────────────────────────────────────────

async function callViaCodeGraph(
  input: Input,
  cwd: string,
  absolutePath: string,
) {
  // Build index if not yet done
  if (!isCodeGraphIndexed()) {
    try {
      await buildCodeGraph(cwd)
    } catch (e) {
      return {
        data: {
          uniqueFilesAffected: 0,
          summary: `Failed to build code graph: ${toError(e).message}`,
        },
      }
    }
  }

  // Try to find the symbol at the given position — use proximity to line, not filename
  const relFile = path.relative(cwd, absolutePath)

  // Primary: find all symbols in this file, pick closest to cursor line
  const fileSymbols = findSymbol('')
    .filter(s => s.file === relFile || s.file.endsWith(relFile))
    .sort(
      (a, b) => Math.abs(a.line - input.line) - Math.abs(b.line - input.line),
    )

  let symbolName: string | undefined
  let bestDist = Infinity
  if (fileSymbols.length > 0) {
    symbolName = fileSymbols[0]!.name
    bestDist = Math.abs(fileSymbols[0]!.line - input.line)
  }

  // Fallback: search globally for the filename base (may match if file is named after its export)
  if (!symbolName || bestDist > 10) {
    const baseName = path
      .basename(input.filePath)
      .replace(/\.(ts|tsx|js|jsx)$/, '')
    const globalDefs = findSymbol(baseName)
    for (const def of globalDefs) {
      if (def.file === relFile || def.file.endsWith(input.filePath)) {
        const dist = Math.abs(def.line - input.line)
        if (dist < bestDist) {
          bestDist = dist
          symbolName = def.name
        }
      }
    }
  }

  if (!symbolName) {
    return {
      data: {
        uniqueFilesAffected: 0,
        summary: `[CodeGraph] Could not identify a symbol at ${input.filePath}:${input.line}. CodeGraph uses regex-based extraction — try placing the cursor on a function/class name.`,
      },
    }
  }

  // ── Walk the graph ──
  const defs = findSymbol(symbolName)
  const callers = findCallers(symbolName)
  const callees = findCallees(symbolName)
  const blastFiles = getBlastRadius(symbolName)

  const allFiles = new Set<string>(blastFiles)
  const callerFiles = new Set(callers.map(c => c.file))
  const calleeFiles = new Set(callees.map(c => c.file))

  const summary = [
    `[CodeGraph] Impact analysis for ${symbolName}:`,
    defs.length > 0
      ? `  Defined in ${defs[0]!.file}:${defs[0]!.line} (${defs[0]!.kind}${defs[0]!.exported ? ', exported' : ''})`
      : `  No definition found`,
    `  ${callers.length} caller(s) across ${callerFiles.size} file(s)`,
    `  ${callees.length} callee(s) across ${calleeFiles.size} file(s)`,
    `  ${allFiles.size} unique file(s) in blast radius`,
    '',
    callers.length > 0
      ? `⚠️  Changing this symbol may break ${callers.length} call site(s).`
      : '✅ No callers found — safe to change signature.',
    '',
    'Note: CodeGraph uses regex-based extraction. For precise analysis, enable LSP (ENABLE_LSP_TOOL=1).',
  ].join('\n')

  return {
    data: {
      symbolName,
      callers: callers.length > 0 ? callers : undefined,
      callees: callees.length > 0 ? callees : undefined,
      references: blastFiles.length > 0 ? blastFiles : undefined,
      uniqueFilesAffected: allFiles.size,
      summary,
    },
  }
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export const ImpactAnalysisTool = buildTool({
  name: IMPACT_ANALYSIS_TOOL_NAME,
  searchHint:
    'analyze impact of changing a code symbol (callers/callees/blast radius)',
  maxResultSizeChars: 20_000,
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  requiresUserInteraction() {
    return false
  },
  userFacingName: () => 'Impact Analysis',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    return checkReadPermissionForTool(
      ImpactAnalysisTool,
      input,
      context.getAppState().toolPermissionContext,
    )
  },
  async call(input: Input, context) {
    try {
      const cwd = getCwd()
      const absolutePath = toAbsolute(input.filePath, cwd)

      // ── Path 1: LSP (precise, when available) ──
      if (isLspConnected()) {
        return await callViaLsp(input, cwd, absolutePath)
      }

      // ── Path 2: CodeGraph (regex-based, always available) ──
      return await callViaCodeGraph(input, cwd, absolutePath)
    } catch (error) {
      const err = toError(error)
      logError(
        new Error(
          `ImpactAnalysis failed for ${input.filePath}: ${err.message}`,
        ),
      )
      return {
        data: {
          uniqueFilesAffected: 0,
          summary: `Error: ${err.message}`,
        },
      }
    }
  },
  renderToolUseMessage(input) {
    return `Impact analysis at ${input.filePath}:${input.line}:${input.character}`
  },
  renderToolResultMessage(output) {
    return output.summary
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.summary,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
