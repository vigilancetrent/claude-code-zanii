import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getProjectDir } from './sessionStorage.js'

/**
 * Deterministic failure mining over this project's session transcripts —
 * the "mine failure patterns" step of a self-harness loop. Everything here
 * is counting; the judgement is left to the /harness-improve skill.
 */
export type HarnessReport = {
  sessions: number
  toolCalls: number
  failingCommands: Array<{
    tool: string
    head: string
    failures: number
    total: number
  }>
  deniedTools: Array<{ tool: string; count: number }>
  repeatedFailureStreaks: number
  userCorrections: Array<{ text: string; count: number }>
  undoCount: number
  interruptedTurns: number
}

const CORRECTION_RE =
  /^(no[,.! ]|not that|wrong|don'?t |stop|undo|revert|that'?s not|why did you|you (broke|deleted|removed)|again\b|still (broken|wrong|failing))/i
const DENIAL_RE =
  /doesn'?t want to proceed|permission denied|denied by|user rejected|rejected the/i

type Row = {
  type?: string
  message?: { content?: unknown }
  isMeta?: boolean
  timestamp?: string
}

function commandHead(tool: string, input: Record<string, unknown>): string {
  const raw =
    typeof input.command === 'string'
      ? input.command
      : typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.pattern === 'string'
          ? input.pattern
          : ''
  return raw.trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 60)
}

export function mineTranscript(rows: Row[], acc: MutableReport): void {
  const results = new Map<string, { isError: boolean; text: string }>()
  for (const r of rows) {
    const c = r.message?.content
    if (r.type !== 'user' || !Array.isArray(c)) continue
    for (const b of c as Array<Record<string, unknown>>) {
      if (b.type === 'tool_result') {
        const text =
          typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content)
              ? (b.content as Array<{ text?: string }>)
                  .map(x => x.text ?? '')
                  .join('\n')
              : ''
        results.set(String(b.tool_use_id), {
          isError: b.is_error === true,
          text,
        })
      }
    }
  }
  let lastKey = ''
  let streak = 0
  for (const r of rows) {
    const c = r.message?.content
    if (r.type === 'user' && !r.isMeta && typeof c === 'string') {
      const t = c.trim()
      if (t === '/undo') acc.undoCount++
      else if (CORRECTION_RE.test(t)) {
        const key = t.slice(0, 80)
        acc.corrections.set(key, (acc.corrections.get(key) ?? 0) + 1)
      }
      continue
    }
    if (r.type !== 'assistant' || !Array.isArray(c)) continue
    for (const b of c as Array<Record<string, unknown>>) {
      if (b.type !== 'tool_use') continue
      const res = results.get(String(b.id))
      if (!res) continue
      acc.toolCalls++
      const tool = String(b.name)
      const key = `${tool}\u0000${commandHead(tool, (b.input as Record<string, unknown>) ?? {})}`
      const stat = acc.commands.get(key) ?? { failures: 0, total: 0 }
      stat.total++
      if (res.isError) {
        stat.failures++
        if (DENIAL_RE.test(res.text))
          acc.denied.set(tool, (acc.denied.get(tool) ?? 0) + 1)
        const streakKey = `${tool}:${JSON.stringify(b.input)}`
        streak = streakKey === lastKey ? streak + 1 : 1
        lastKey = streakKey
        if (streak === 3) acc.streaks++
      } else {
        streak = 0
        lastKey = ''
      }
      acc.commands.set(key, stat)
    }
  }
  for (const r of rows) {
    if (
      r.type === 'user' &&
      typeof r.message?.content === 'string' &&
      /\[Request interrupted by user/i.test(r.message.content)
    )
      acc.interrupted++
  }
}

type MutableReport = {
  toolCalls: number
  commands: Map<string, { failures: number; total: number }>
  denied: Map<string, number>
  streaks: number
  corrections: Map<string, number>
  undoCount: number
  interrupted: number
}

export function mineProject(cwd: string, maxSessions = 20): HarnessReport {
  const dir = getProjectDir(cwd)
  let files: string[] = []
  try {
    files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      .slice(0, maxSessions)
  } catch {
    files = []
  }
  const acc: MutableReport = {
    toolCalls: 0,
    commands: new Map(),
    denied: new Map(),
    streaks: 0,
    corrections: new Map(),
    undoCount: 0,
    interrupted: 0,
  }
  for (const f of files) {
    const rows: Row[] = []
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line) as Row)
      } catch {
        // partial line
      }
    }
    mineTranscript(rows, acc)
  }
  return {
    sessions: files.length,
    toolCalls: acc.toolCalls,
    failingCommands: [...acc.commands.entries()]
      .filter(([, s]) => s.failures >= 2)
      .map(([k, s]) => {
        const [tool, head] = k.split('\u0000')
        return { tool: tool ?? '', head: head ?? '', ...s }
      })
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 15),
    deniedTools: [...acc.denied.entries()]
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count),
    repeatedFailureStreaks: acc.streaks,
    userCorrections: [...acc.corrections.entries()]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    undoCount: acc.undoCount,
    interruptedTurns: acc.interrupted,
  }
}

export function formatHarnessReport(r: HarnessReport): string {
  const lines = [
    `Sessions mined: ${r.sessions} · tool calls: ${r.toolCalls} · repeated-failure streaks (3+ identical): ${r.repeatedFailureStreaks} · /undo: ${r.undoCount} · interrupted turns: ${r.interruptedTurns}`,
    '',
    'Failing commands (≥2 failures):',
    ...(r.failingCommands.length
      ? r.failingCommands.map(
          c => `  ${c.tool} ${c.head}  — ${c.failures}/${c.total} failed`,
        )
      : ['  none']),
    '',
    'Permission denials by tool:',
    ...(r.deniedTools.length
      ? r.deniedTools.map(d => `  ${d.tool}: ${d.count}`)
      : ['  none']),
    '',
    'User corrections (verbatim, first 80 chars):',
    ...(r.userCorrections.length
      ? r.userCorrections.map(u => `  ${u.count}× "${u.text}"`)
      : ['  none']),
  ]
  return lines.join('\n')
}
