import { getCwd } from 'src/utils/cwd.js'
import { formatHarnessReport, mineProject } from 'src/utils/harnessMining.js'
import { registerBundledSkill } from '../bundledSkills.js'

const INSTRUCTIONS = `# Harness improve (self-harness loop, bounded)

Above is a deterministic mining report over this project's recent sessions. Turn it into at most 3 bounded harness edits — the smallest changes that would stop the most frequent failure from happening again.

## Editable surfaces (nothing else)
- \`CLAUDE.md\` / \`.claude/rules/*.md\` — a rule the agent keeps violating (evidence: user corrections)
- \`.claude/settings.json\` \`hooks\` — a PreToolUse/PostToolUse check for a command that keeps failing the same way
- \`.claude/settings.json\` \`permissions.allow\` / \`deny\` — a tool that is denied every time (add a deny) or approved every time (add an allow)
- \`.claude/skills/*/SKILL.md\` — a procedure the agent re-derives badly each session (e.g. how to run the tests)
- \`postEditChecks\` in settings — when edits are followed by the same lint/test failure

## For each proposal, write
1. **Evidence**: the report line(s) it comes from (counts, not impressions).
2. **Root cause**: why the harness lets this happen.
3. **Edit**: the exact diff (file + lines). Keep it minimal.
4. **Prediction**: a falsifiable statement the next \`/harness-improve\` run can check — e.g. "\`Bash npm test\` failures drop from 7 to ≤2 over the next 10 sessions".

## Ledger
Append every applied proposal to \`.claude/harness-ledger.md\` as \`- <date> · <file> · <one-line edit> · predicted: <…> · baseline: <numbers>\`. Before proposing, read the ledger: if an earlier prediction is now measurable, report whether it held, and propose reverting edits that did not help.

## Rules
- Ask before applying anything; never apply more than 3 edits per run.
- Do not touch code, tests, or CI — only the surfaces above.
- If the report shows nothing with ≥2 occurrences, say the harness looks healthy and stop.
`

export function registerHarnessImproveSkill(): void {
  registerBundledSkill({
    name: 'harness-improve',
    description:
      'Mine recent sessions for repeated failures and propose bounded CLAUDE.md / hooks / permissions edits with a falsifiable prediction (self-harness loop)',
    userInvocable: true,
    async getPromptForCommand(args) {
      const report = formatHarnessReport(mineProject(getCwd()))
      return [
        {
          type: 'text',
          text: `${report}\n\n${INSTRUCTIONS}${args ? `\n\n## Focus\n\n${args}` : ''}`,
        },
      ]
    },
  })
}
