import { registerBundledSkill } from '../bundledSkills.js'

const PROMPT_AUDIT_PROMPT = `# Prompt audit

Find instructions that have rotted: CLAUDE.md files, \`.claude/rules/*.md\`, skills under \`.claude/skills\` and \`~/.claude/skills\`, and agent definitions under \`.claude/agents\` that reference things which no longer exist or contradict each other.

## Steps

1. Collect the prompt files: \`CLAUDE.md\` at the repo root and in subdirectories, \`~/.claude/CLAUDE.md\`, \`.claude/rules/**/*.md\`, every \`SKILL.md\`, every \`.claude/agents/*.md\`. Read them all.
2. For each file, extract concrete claims: file paths, directory names, script names in \`package.json\`/\`Makefile\`, slash commands, env vars, tool names, package names, version numbers, URLs.
3. Verify each claim against the repo (Glob/Grep/Read) and against the command list you know. Flag:
   - **Dead references**: paths, scripts, commands, env vars that do not exist.
   - **Contradictions**: two files giving conflicting instructions for the same thing (e.g. different test commands, different formatters).
   - **Duplicates**: the same rule stated in more than one file — keep the most specific location.
   - **Stale facts**: counts, versions or "currently disabled" notes that no longer match the code.
   - **Overlong sections**: instructions the repo already enforces mechanically (lint rules, pre-commit hooks) and that only cost context.
4. Report a table: file · line · finding · suggested fix. Sort by impact (dead references first).
5. Ask before editing. If the user says fix, apply the edits with the Edit tool, smallest diff per file, and leave a one-line note of what changed at the end.

Do not rewrite prose style. Only fix what is wrong, contradictory, duplicated or dead.
`

export function registerPromptAuditSkill(): void {
  registerBundledSkill({
    name: 'prompt-audit',
    description:
      'Flag and fix outdated CLAUDE.md, rules, skills and agent prompts (dead paths, contradictions, duplicates).',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = PROMPT_AUDIT_PROMPT
      if (args) prompt += `\n\n## Focus\n\n${args}`
      return [{ type: 'text', text: prompt }]
    },
  })
}
