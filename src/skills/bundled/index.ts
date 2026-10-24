import { feature } from 'bun:bundle'
import { logForDebugging } from 'src/utils/debug.js'
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { registerBatchSkill } from './batch.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerUseArtifactsSkill } from './useArtifacts.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerUltracodeSkill } from './ultracode.js'
import { registerCronDeleteSkill, registerCronListSkill } from './cronManage.js'
import { registerLoopSkill } from './loop.js'
import { registerDreamSkill } from './dream.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'
import { registerPromptAuditSkill } from './promptAudit.js'
import { registerDeepResearchSkill } from './deepResearch.js'
import { registerHarnessImproveSkill } from './harnessImprove.js'
import {
  registerRunSkill,
  registerRunSkillGeneratorSkill,
} from './runSkillGenerator.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  try {
    initBundledSkillsUnsafe()
  } catch (error) {
    // A missing or broken bundled skill must degrade to "that skill is
    // absent", never to a hung or dead startup.
    logForDebugging(`[bundledSkills] init failed: ${error}`, { level: 'error' })
  }
}

function initBundledSkillsUnsafe(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerUseArtifactsSkill()
  registerBatchSkill()
  registerStuckSkill()
  registerUltracodeSkill()
  registerLoopSkill()
  registerCronListSkill()
  registerCronDeleteSkill()
  registerDreamSkill()
  registerPromptAuditSkill()
  if (feature('WORKFLOW_SCRIPTS')) {
    registerDeepResearchSkill()
  }
  if (feature('REVIEW_ARTIFACT')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerHunterSkill } = require('./hunter.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerHunterSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      registerScheduleRemoteAgentsSkill,
    } = require('./scheduleRemoteAgents.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerClaudeApiSkill } = require('./claudeApi.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    registerRunSkill()
    registerRunSkillGeneratorSkill()
  }
  registerHarnessImproveSkill()
}
