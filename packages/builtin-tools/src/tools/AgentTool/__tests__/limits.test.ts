import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { debugMock } from '../../../../../../tests/mocks/debug.js'
import { logMock } from '../../../../../../tests/mocks/log.js'
import type { SettingsJson } from 'src/utils/settings/types.js'

mock.module('bun:bundle', () => ({ feature: () => false }))
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const settings = await import('src/utils/settings/settings.js')
const limits = await import('../limits.js')
let currentSettings: SettingsJson = {}
const settingsSpy = spyOn(settings, 'getInitialSettings').mockImplementation(
  () => currentSettings,
)
const depthBefore = process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
const concurrencyBefore = process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS

beforeEach(() => {
  currentSettings = {}
  delete process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
  delete process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS
})
afterAll(() => {
  settingsSpy.mockRestore()
  if (depthBefore === undefined)
    delete process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
  else process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = depthBefore
  if (concurrencyBefore === undefined)
    delete process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS
  else process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = concurrencyBefore
})

describe('subagent limits', () => {
  test('uses the documented defaults and depth boundary', () => {
    expect(limits.getMaxSubagentSpawnDepth()).toBe(3)
    expect(limits.getMaxConcurrentSubagents()).toBe(20)
    expect(limits.canSpawnAtDepth()).toBe(true)
    expect(limits.canSpawnAtDepth(2)).toBe(true)
    expect(limits.canSpawnAtDepth(3)).toBe(false)
  })

  test('reads settings and gives valid environment overrides precedence', () => {
    currentSettings = { maxSubagentDepth: 2, maxConcurrentSubagents: 4 }
    expect(limits.getMaxSubagentSpawnDepth()).toBe(2)
    expect(limits.getMaxConcurrentSubagents()).toBe(4)
    process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = '1'
    process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = '6'
    expect(limits.getMaxSubagentSpawnDepth()).toBe(1)
    expect(limits.getMaxConcurrentSubagents()).toBe(6)
    expect(limits.canSpawnAtDepth(1)).toBe(false)
  })

  test('rejects malformed limits and invalid caller depths', () => {
    currentSettings = { maxSubagentDepth: 2, maxConcurrentSubagents: 4 }
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      'Infinity',
      'NaN',
      '1e30',
      '2junk',
    ]) {
      process.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = value
      process.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = value
      expect(limits.getMaxSubagentSpawnDepth()).toBe(2)
      expect(limits.getMaxConcurrentSubagents()).toBe(4)
    }
    for (const depth of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(limits.canSpawnAtDepth(depth)).toBe(false)
    }
  })
})
