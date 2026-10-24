import { afterEach, describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
// MACRO is a build-time define; verify's bundled files resolve an extract dir from MACRO.VERSION.
;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

import type { PromptCommand } from '../../../types/command.js'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import { registerHarnessImproveSkill } from '../harnessImprove.js'
import {
  registerRunSkill,
  registerRunSkillGeneratorSkill,
} from '../runSkillGenerator.js'
import { registerVerifySkill } from '../verify.js'

afterEach(() => {
  clearBundledSkills()
})

function skill(name: string): PromptCommand {
  const c = getBundledSkills().find(s => s.name === name)
  expect(c).toBeDefined()
  return c as unknown as PromptCommand
}

describe('run / run-skill-generator / verify / harness-improve', () => {
  test('all four register for every user and build prompts that carry the args', async () => {
    registerRunSkill()
    registerRunSkillGeneratorSkill()
    registerVerifySkill()
    registerHarnessImproveSkill()
    for (const n of [
      'run',
      'run-skill-generator',
      'verify',
      'harness-improve',
    ]) {
      const blocks = await skill(n).getPromptForCommand(
        'focus on tests',
        {} as never,
      )
      const text = (blocks[0] as { text: string }).text
      expect(text.length).toBeGreaterThan(200)
      expect(text).toContain('focus on tests')
    }
    expect(
      (await skill('verify').getPromptForCommand('', {} as never))[0],
    ).toMatchObject({
      type: 'text',
      text: expect.stringContaining('.claude/skills/run/SKILL.md'),
    })
    const hi = (
      await skill('harness-improve').getPromptForCommand('', {} as never)
    )[0] as { text: string }
    expect(hi.text).toContain('Sessions mined:')
    expect(hi.text).toContain('harness-ledger.md')
  })
})
