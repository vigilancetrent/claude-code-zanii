import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'

const DEFAULT_MAX_SPAWN_DEPTH = 3
const DEFAULT_MAX_CONCURRENT = 20

function positiveInt(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * How many layers of subagents may exist below the main conversation.
 * 1 = no nesting. env > settings.maxSubagentDepth > 3 (upstream default).
 */
export function getMaxSubagentSpawnDepth(): number {
  return (
    positiveInt(process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH) ??
    positiveInt(getSettings_DEPRECATED()?.maxSubagentDepth) ??
    DEFAULT_MAX_SPAWN_DEPTH
  )
}

export function getMaxConcurrentSubagents(): number {
  return (
    positiveInt(process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) ??
    positiveInt(getSettings_DEPRECATED()?.maxConcurrentSubagents) ??
    DEFAULT_MAX_CONCURRENT
  )
}

/** Depth the child would run at; a spawn is allowed while this is within the max. */
export function canSpawnAtDepth(parentDepth: number | undefined): boolean {
  return (parentDepth ?? 0) + 1 <= getMaxSubagentSpawnDepth()
}
