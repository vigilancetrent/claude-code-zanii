import type { LocalCommandCall } from '../../types/command.js'
import { join } from 'path'
import { access, mkdir, readFile, writeFile, rm, readdir } from 'fs/promises'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

// ── Validation rules ─────────────────────────────────────────────────────────

const SKILL_VALIDATORS: Array<{
  name: string
  check: (content: string) => string | null
}> = [
  {
    name: 'has-description',
    check: c => {
      const fm = c.match(/^---\n([\s\S]*?)\n---/)
      if (fm && fm[1]?.includes('description:')) return null
      const body = fm ? c.slice(fm[0].length).trim() : c
      const firstPara = body.split('\n\n')[0]
      if (firstPara && firstPara.length > 20) return null
      return 'Skill should have a description in frontmatter or a clear opening paragraph'
    },
  },
  {
    name: 'not-empty',
    check: c => {
      const body = c.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
      return body.length < 50
        ? 'Skill content is too short (min 50 chars)'
        : null
    },
  },
  {
    name: 'has-trigger',
    check: c => {
      const lower = c.toLowerCase()
      if (
        lower.includes('when to use') ||
        lower.includes('trigger') ||
        lower.includes('use when') ||
        lower.includes('use this')
      )
        return null
      return 'Consider adding a "When to use" or trigger section'
    },
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function findProjectSkill(name: string): Promise<string | null> {
  const cwd = process.cwd()
  const home = process.env.USERPROFILE || process.env.HOME || ''
  let dir = cwd
  while (dir && dir !== home && dir !== `${home}`) {
    const skillPath = join(dir, '.claude', 'skills', name, 'SKILL.md')
    if (await pathExists(skillPath)) return skillPath
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function findUserSkill(name: string): Promise<string | null> {
  const skillPath = join(getUserSkillsDir(), name, 'SKILL.md')
  return (await pathExists(skillPath)) ? skillPath : null
}

function getUserSkillsDir(): string {
  return join(getClaudeConfigHomeDir(), 'skills')
}

function getUserSkillPath(name: string): string {
  return join(getUserSkillsDir(), name, 'SKILL.md')
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      fm[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim()
    }
  }
  return fm
}

function stampFrontmatter(
  content: string,
  fields: Record<string, string>,
): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) {
    const fm = Object.entries(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    return `---\n${fm}\n---\n\n${content}`
  }

  let fm = fmMatch[1]!
  for (const [key, value] of Object.entries(fields)) {
    const linePattern = new RegExp(
      `^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`,
      'm',
    )
    if (linePattern.test(fm)) {
      fm = fm.replace(linePattern, `${key}: ${value}`)
    } else {
      fm = fm.trimEnd() + `\n${key}: ${value}`
    }
  }
  return content.replace(fmMatch[0], `---\n${fm}\n---`)
}

function validateSkill(content: string): string[] {
  const warnings: string[] = []
  for (const v of SKILL_VALIDATORS) {
    const msg = v.check(content)
    if (msg) warnings.push(`[${v.name}] ${msg}`)
  }
  return warnings
}

function getNextVersion(currentVersion: string | undefined): string {
  if (!currentVersion) return '0.1.0'
  const parts = currentVersion.split('.').map(Number)
  if (parts.some(isNaN)) return '0.1.0'
  const [major = 0, minor = 0, patch = 0] = parts
  return `${major}.${minor}.${patch + 1}`
}

async function listAllSkills(): Promise<
  Array<{ name: string; path: string; scope: 'project' | 'user' }>
> {
  const skills: Array<{
    name: string
    path: string
    scope: 'project' | 'user'
  }> = []
  const cwd = process.cwd()
  const home = process.env.USERPROFILE || process.env.HOME || ''

  // Project scope
  let dir = cwd
  while (dir && dir !== home) {
    const skillsDir = join(dir, '.claude', 'skills')
    if (await pathExists(skillsDir)) {
      try {
        for (const entry of await readdir(skillsDir)) {
          const skillFile = join(skillsDir, entry, 'SKILL.md')
          if (await pathExists(skillFile)) {
            skills.push({ name: entry, path: skillFile, scope: 'project' })
          }
        }
      } catch {
        /* ignore */
      }
      break
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  // User scope
  const userDir = getUserSkillsDir()
  if (await pathExists(userDir)) {
    try {
      for (const entry of await readdir(userDir)) {
        const skillFile = join(userDir, entry, 'SKILL.md')
        if (await pathExists(skillFile)) {
          skills.push({ name: entry, path: skillFile, scope: 'user' })
        }
      }
    } catch {
      /* ignore */
    }
  }

  return skills
}

// ── Commands ─────────────────────────────────────────────────────────────────

type Result = { type: 'text'; value: string }

export const call: LocalCommandCall = async args => {
  const parts = args.trim().split(/\s+/)
  const action = parts[0] ?? 'list'
  const skillName = parts[1]

  switch (action) {
    case 'list':
      return await handleList()
    case 'promote':
      return await handlePromote(skillName)
    case 'demote':
      return await handleDemote(skillName)
    case 'validate':
      return await handleValidate(skillName)
    case 'version':
      return await handleVersion(skillName)
    default:
      return {
        type: 'text' as const,
        value: `Unknown action "${action}". Available: list, promote, demote, validate, version`,
      }
  }
}

async function handleList(): Promise<Result> {
  const skills = await listAllSkills()
  if (skills.length === 0) {
    return {
      type: 'text',
      value:
        'No skills found. Create a skill in .claude/skills/<name>/SKILL.md',
    }
  }
  const lines = await Promise.all(
    skills.map(async s => {
      try {
        const content = await readFile(s.path, 'utf-8')
        const fm = parseFrontmatter(content)
        const version = fm['version'] ?? '0.0.0'
        const status = fm['status'] ?? 'draft'
        return `  [${s.scope}] ${s.name} v${version} (${status})`
      } catch {
        return `  [${s.scope}] ${s.name} (file unreadable)`
      }
    }),
  )
  return {
    type: 'text',
    value: `Found ${skills.length} skill(s):\n${lines.join('\n')}`,
  }
}

async function handlePromote(name: string | undefined): Promise<Result> {
  if (!name) {
    return {
      type: 'text',
      value: `Usage: /skill-promote promote <skill-name>\n  Copies project skill to user scope with version bump.`,
    }
  }

  const projectPath = await findProjectSkill(name)
  if (!projectPath) {
    return {
      type: 'text',
      value: `Skill "${name}" not found in any .claude/skills/ directory.`,
    }
  }

  const userPath = getUserSkillPath(name)
  if (await pathExists(userPath)) {
    const existing = await readFile(userPath, 'utf-8')
    const existingFm = parseFrontmatter(existing)
    const nextVersion = getNextVersion(existingFm['version'])
    const content = await readFile(projectPath, 'utf-8')
    const promoted = stampFrontmatter(content, {
      status: 'stable',
      version: nextVersion,
      promotedAt: new Date().toISOString(),
      promotedFrom: projectPath,
    })
    await mkdir(join(getUserSkillsDir(), name), { recursive: true })
    await writeFile(userPath, promoted, 'utf-8')
    return {
      type: 'text',
      value: `Updated "${name}" to user scope v${nextVersion}:\n  From: ${projectPath}\n  To:   ${userPath}`,
    }
  }

  const content = await readFile(projectPath, 'utf-8')
  const fm = parseFrontmatter(content)
  const nextVersion = getNextVersion(fm['version'])
  const promoted = stampFrontmatter(content, {
    status: 'stable',
    version: nextVersion,
    promotedAt: new Date().toISOString(),
    promotedFrom: projectPath,
  })
  await mkdir(join(getUserSkillsDir(), name), { recursive: true })
  await writeFile(userPath, promoted, 'utf-8')
  return {
    type: 'text',
    value: `Promoted "${name}" to user scope v${nextVersion}:\n  From: ${projectPath}\n  To:   ${userPath}`,
  }
}

async function handleDemote(name: string | undefined): Promise<Result> {
  if (!name) {
    return { type: 'text', value: `Usage: /skill-promote demote <skill-name>` }
  }
  const userPath = getUserSkillPath(name)
  if (!(await pathExists(userPath))) {
    return { type: 'text', value: `No user-scope skill "${name}" found.` }
  }
  await rm(join(getUserSkillsDir(), name), { recursive: true, force: true })
  return { type: 'text', value: `Demoted "${name}" — removed user-scope copy.` }
}

async function handleValidate(name: string | undefined): Promise<Result> {
  if (!name) {
    return {
      type: 'text',
      value: `Usage: /skill-promote validate <skill-name>`,
    }
  }
  const skillPath =
    (await findProjectSkill(name)) ?? (await findUserSkill(name))
  if (!skillPath) {
    return { type: 'text', value: `Skill "${name}" not found.` }
  }
  const content = await readFile(skillPath, 'utf-8')
  const warnings = validateSkill(content)
  if (warnings.length === 0) {
    return {
      type: 'text',
      value: `Skill "${name}" passed all validation checks.`,
    }
  }
  return {
    type: 'text',
    value: `Skill "${name}" has ${warnings.length} warning(s):\n${warnings.map(w => `  ⚠ ${w}`).join('\n')}`,
  }
}

async function handleVersion(name: string | undefined): Promise<Result> {
  if (!name) {
    const skills = await listAllSkills()
    if (skills.length === 0) {
      return { type: 'text', value: 'No skills found.' }
    }
    const lines = await Promise.all(
      skills.map(async s => {
        const content = await readFile(s.path, 'utf-8')
        const fm = parseFrontmatter(content)
        return `  ${s.name}: v${fm['version'] ?? '0.0.0'} (${fm['status'] ?? 'draft'})`
      }),
    )
    return { type: 'text', value: `Skill versions:\n${lines.join('\n')}` }
  }
  const skillPath =
    (await findProjectSkill(name)) ?? (await findUserSkill(name))
  if (!skillPath) {
    return { type: 'text', value: `Skill "${name}" not found.` }
  }
  const content = await readFile(skillPath, 'utf-8')
  const fm = parseFrontmatter(content)
  return {
    type: 'text',
    value: `${name}: v${fm['version'] ?? '0.0.0'} (${fm['status'] ?? 'draft'})\n  Path: ${skillPath}`,
  }
}
