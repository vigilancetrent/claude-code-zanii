import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, relative } from 'path'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

type Source = 'cursor' | 'codex' | 'copilot'
const SOURCES: Source[] = ['cursor', 'codex', 'copilot']

export type ImportPlan = {
  instructionFiles: string[] // repo-relative, referenced as @path from CLAUDE.md
  mcpServers: Record<string, unknown>
  notes: string[]
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => join(dir, f))
}

/** Pure: decide what to import from a source, given the repo root. */
export function planImport(source: Source, cwd: string): ImportPlan {
  const plan: ImportPlan = { instructionFiles: [], mcpServers: {}, notes: [] }
  const rel = (p: string) => relative(cwd, p).replaceAll('\\', '/')
  const addIfExists = (p: string) => {
    if (existsSync(p)) plan.instructionFiles.push(rel(p))
  }
  switch (source) {
    case 'cursor':
      addIfExists(join(cwd, '.cursorrules'))
      for (const f of listFiles(join(cwd, '.cursor', 'rules'), '.mdc')) {
        plan.instructionFiles.push(rel(f))
      }
      break
    case 'copilot':
      addIfExists(join(cwd, '.github', 'copilot-instructions.md'))
      for (const f of listFiles(
        join(cwd, '.github', 'instructions'),
        '.instructions.md',
      )) {
        plan.instructionFiles.push(rel(f))
      }
      break
    case 'codex': {
      addIfExists(join(cwd, 'AGENTS.md'))
      const toml = [
        join(cwd, '.codex', 'config.toml'),
        join(homedir(), '.codex', 'config.toml'),
      ].find(existsSync)
      if (toml) {
        const parser = (
          globalThis as { Bun?: { TOML?: { parse(s: string): unknown } } }
        ).Bun?.TOML
        if (!parser) {
          plan.notes.push(
            `${toml} found but TOML parsing needs the bun runtime; copy [mcp_servers] by hand.`,
          )
        } else {
          const cfg = parser.parse(readFileSync(toml, 'utf8')) as {
            mcp_servers?: Record<
              string,
              {
                command?: string
                args?: string[]
                env?: Record<string, string>
                url?: string
              }
            >
          }
          for (const [name, s] of Object.entries(cfg.mcp_servers ?? {})) {
            plan.mcpServers[name] = s.url
              ? { type: 'http', url: s.url }
              : {
                  command: s.command,
                  args: s.args ?? [],
                  ...(s.env && { env: s.env }),
                }
          }
        }
      }
      break
    }
  }
  return plan
}

export function renderClaudeMdSection(source: Source, files: string[]): string {
  return [
    '',
    `## Imported from ${source}`,
    ...files.map(f => `@${f}`),
    '',
  ].join('\n')
}

export function applyImport(
  source: Source,
  plan: ImportPlan,
  cwd: string,
): string[] {
  const done: string[] = []
  if (plan.instructionFiles.length > 0) {
    const claudeMd = join(cwd, 'CLAUDE.md')
    const existing = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : ''
    const missing = plan.instructionFiles.filter(
      f => !existing.includes(`@${f}`),
    )
    if (missing.length > 0) {
      writeFileSync(claudeMd, existing + renderClaudeMdSection(source, missing))
      done.push(`CLAUDE.md: added ${missing.length} @import line(s)`)
    }
  }
  const names = Object.keys(plan.mcpServers)
  if (names.length > 0) {
    const mcpJson = join(cwd, '.mcp.json')
    const current = existsSync(mcpJson)
      ? (JSON.parse(readFileSync(mcpJson, 'utf8')) as {
          mcpServers?: Record<string, unknown>
        })
      : {}
    const merged = {
      ...current,
      mcpServers: { ...plan.mcpServers, ...current.mcpServers },
    }
    writeFileSync(mcpJson, `${JSON.stringify(merged, null, 2)}\n`)
    done.push(
      `.mcp.json: merged ${names.length} server(s) (${names.join(', ')})`,
    )
  }
  return done
}

export const call: LocalCommandCall = async args => {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const dryRun = tokens.includes('--dry-run')
  const source = tokens.find((t): t is Source => SOURCES.includes(t as Source))
  if (!source) {
    return {
      type: 'text',
      value: `Usage: /import <${SOURCES.join('|')}> [--dry-run]`,
    }
  }
  const cwd = getCwd()
  const plan = planImport(source, cwd)
  const lines = [
    `Import from ${source}:`,
    ...plan.instructionFiles.map(f => `  CLAUDE.md ← @${f}`),
    ...Object.keys(plan.mcpServers).map(n => `  .mcp.json ← mcpServers.${n}`),
    ...plan.notes.map(n => `  note: ${n}`),
  ]
  if (
    plan.instructionFiles.length === 0 &&
    Object.keys(plan.mcpServers).length === 0
  ) {
    lines.push('  nothing found')
    return { type: 'text', value: lines.join('\n') }
  }
  if (dryRun) {
    lines.push('(dry run — nothing written)')
    return { type: 'text', value: lines.join('\n') }
  }
  const done = applyImport(source, plan, cwd)
  return {
    type: 'text',
    value: [...lines, ...(done.length ? done : ['already imported'])].join(
      '\n',
    ),
  }
}
