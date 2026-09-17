import { estimateSkillFrontmatterTokens } from '../../skills/loadSkillsDir.js'
import type { Command, LocalCommandCall } from '../../types/command.js'
import { getCommandName } from '../../types/command.js'
import { getGlobalConfig } from '../../utils/config.js'

const SKILL_SOURCES = new Set(['skills', 'plugin', 'managed', 'bundled', 'mcp'])

type SkillRow = {
  name: string
  source: string
  tokens: number
  usageCount: number
  lastUsedAt: number | undefined
}

export function buildSkillRows(
  commands: Command[],
  skillUsage: Record<string, { usageCount: number; lastUsedAt: number }> = {},
): SkillRow[] {
  return commands
    .filter(c => c.loadedFrom && SKILL_SOURCES.has(c.loadedFrom) && !c.isHidden)
    .map(c => {
      const name = getCommandName(c)
      const usage = skillUsage[name] ?? skillUsage[c.name]
      return {
        name,
        source: c.loadedFrom as string,
        tokens: estimateSkillFrontmatterTokens(c),
        usageCount: usage?.usageCount ?? 0,
        lastUsedAt: usage?.lastUsedAt,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)
}

export function formatSkillReport(rows: SkillRow[]): string {
  if (rows.length === 0) return 'No skills loaded.'
  const total = rows.reduce((n, r) => n + r.tokens, 0)
  const unused = rows.filter(r => r.usageCount === 0)
  const unusedTokens = unused.reduce((n, r) => n + r.tokens, 0)
  const width = Math.max(...rows.map(r => r.name.length))
  const lines = rows.map(r => {
    const last = r.lastUsedAt
      ? `${Math.floor((Date.now() - r.lastUsedAt) / 86_400_000)}d ago`
      : 'never'
    return `  ${r.name.padEnd(width)}  ${String(r.tokens).padStart(5)} tok  ${r.source.padEnd(7)}  used ${r.usageCount}× (${last})`
  })
  const out = [
    `${rows.length} skills, ~${total} tokens of frontmatter in every request`,
    ...lines,
  ]
  if (unused.length > 0) {
    out.push(
      '',
      `${unused.length} never used (~${unusedTokens} tokens): ${unused.map(r => r.name).join(', ')}`,
      'Prune with `disableModelInvocation: true` / `userInvocable: false` in the skill frontmatter, or remove the skill dir.',
    )
  }
  return out.join('\n')
}

export const call: LocalCommandCall = async (_args, context) => {
  const rows = buildSkillRows(
    context.options.commands,
    getGlobalConfig().skillUsage,
  )
  return { type: 'text', value: formatSkillReport(rows) }
}
