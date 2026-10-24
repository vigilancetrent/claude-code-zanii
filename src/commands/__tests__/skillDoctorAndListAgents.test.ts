import { describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { buildSkillRows, formatSkillReport } = await import(
  '../skill-doctor/skill-doctor.js'
)
const { agentRows, formatAgentRows } = await import(
  '../list-agents/list-agents.js'
)

describe('/skill-doctor', () => {
  test('lists only skills, sorted by token cost, and flags unused ones', () => {
    const cmds = [
      {
        name: 'big',
        description: 'x '.repeat(200),
        loadedFrom: 'skills',
        type: 'prompt',
      },
      {
        name: 'small',
        description: 'tiny',
        loadedFrom: 'plugin',
        type: 'prompt',
      },
      { name: 'effort', description: 'builtin', type: 'local' },
      {
        name: 'hidden',
        description: 'h',
        loadedFrom: 'skills',
        isHidden: true,
      },
    ] as any
    const rows = buildSkillRows(cmds, {
      small: { usageCount: 3, lastUsedAt: Date.now() },
    })
    expect(rows.map(r => r.name)).toEqual(['big', 'small'])
    expect(rows[0]!.tokens).toBeGreaterThan(rows[1]!.tokens)
    const report = formatSkillReport(rows)
    expect(report).toContain('1 never used')
    expect(report).toContain('big')
    expect(formatSkillReport([])).toBe('No skills loaded.')
  })
})

describe('/list-agents', () => {
  test('maps agent-like tasks and skips shell tasks', () => {
    const rows = agentRows({
      a: {
        type: 'local_agent',
        agentId: 'a1',
        agentType: 'Explore',
        status: 'running',
        description: 'look',
      },
      b: { type: 'local_bash', status: 'running', description: 'npm test' },
      c: {
        type: 'in_process_teammate',
        identity: { agentName: 'researcher' },
        status: 'completed',
        description: 'r',
      },
    } as any)
    expect(rows.map(r => r.name).sort()).toEqual(['a1', 'researcher'])
    expect(formatAgentRows(rows)).toContain('researcher')
    expect(formatAgentRows([])).toContain('/subtask')
  })
})
