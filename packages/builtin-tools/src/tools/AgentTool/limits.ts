import { getInitialSettings } from 'src/utils/settings/settings.js'

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' &&
    Number.isSafeInteger(number) &&
    number > 0
    ? number
    : undefined
}

export function getMaxSubagentSpawnDepth(): number {
  return (
    positiveInteger(process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH) ??
    positiveInteger(getInitialSettings().maxSubagentDepth) ??
    3
  )
}

export function getMaxConcurrentSubagents(): number {
  return (
    positiveInteger(process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) ??
    positiveInteger(getInitialSettings().maxConcurrentSubagents) ??
    20
  )
}

export function canSpawnAtDepth(depth = 0): boolean {
  return (
    Number.isSafeInteger(depth) &&
    depth >= 0 &&
    depth < getMaxSubagentSpawnDepth()
  )
}
