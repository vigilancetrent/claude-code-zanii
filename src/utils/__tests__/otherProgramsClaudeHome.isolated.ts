// Isolated: needs the real envUtils, which other test files in the shared
// process replace with a mock.
import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isOtherProgramsClaudeHome } from '../envUtils.js'

const original = process.env.CLAUDE_CONFIG_DIR
afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = original
})

describe('isOtherProgramsClaudeHome', () => {
  const home = homedir()

  test("Claude Code's ~/.claude and everything in it is another program's", () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(isOtherProgramsClaudeHome(join(home, '.claude'))).toBe(true)
    expect(isOtherProgramsClaudeHome(join(home, '.claude', 'CLAUDE.md'))).toBe(
      true,
    )
    expect(
      isOtherProgramsClaudeHome(join(home, '.claude', 'settings.json')),
    ).toBe(true)
    expect(
      isOtherProgramsClaudeHome(join(home, '.claude', 'rules', 'a.md')),
    ).toBe(true)
  })

  test('a project .claude folder, and this CLI own folder, are not', () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(
      isOtherProgramsClaudeHome(
        join(home, 'code', 'app', '.claude', 'CLAUDE.md'),
      ),
    ).toBe(false)
    expect(
      isOtherProgramsClaudeHome(join(home, '.zaniicode', 'CLAUDE.md')),
    ).toBe(false)
    // A sibling whose name only starts with ".claude".
    expect(
      isOtherProgramsClaudeHome(join(home, '.claude-backup', 'x.md')),
    ).toBe(false)
    expect(isOtherProgramsClaudeHome(join(home, 'CLAUDE.md'))).toBe(false)
  })

  test('is this CLI own folder when CLAUDE_CONFIG_DIR points there on purpose', () => {
    process.env.CLAUDE_CONFIG_DIR = join(home, '.claude')
    expect(isOtherProgramsClaudeHome(join(home, '.claude', 'CLAUDE.md'))).toBe(
      false,
    )
  })
})
