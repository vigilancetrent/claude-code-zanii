import { describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { getConfiguredModelCosts } = await import('../modelCost.js')
const { withPostEditChecks } = await import('../hooks/hooksConfigSnapshot.js')

describe('modelPricing lookup', () => {
  const pricing = {
    'gpt-5': { input: 1.25, output: 10 },
    qwen3: { input: 0.2, output: 0.6, cacheRead: 0.05 },
  }
  test('exact match wins, then longest prefix', () => {
    expect(getConfiguredModelCosts('gpt-5', pricing)?.outputTokens).toBe(10)
    expect(getConfiguredModelCosts('qwen3.8-27b', pricing)?.inputTokens).toBe(
      0.2,
    )
    expect(
      getConfiguredModelCosts('QWEN3-coder', pricing)?.promptCacheReadTokens,
    ).toBe(0.05)
  })
  test('cache defaults derive from input; unknown → undefined', () => {
    const c = getConfiguredModelCosts('gpt-5', pricing)!
    expect(c.promptCacheWriteTokens).toBe(1.25)
    expect(c.promptCacheReadTokens).toBeCloseTo(0.125)
    expect(getConfiguredModelCosts('claude-opus-4-7', pricing)).toBeUndefined()
    expect(getConfiguredModelCosts('gpt-5', undefined)).toBeUndefined()
  })
})

describe('postEditChecks → PostToolUse hook', () => {
  test('synthesizes one matcher with lint and test commands, appended after user hooks', () => {
    const out = withPostEditChecks(
      {
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo x' }] },
        ],
      } as any,
      { postEditChecks: { lint: 'bun run lint', test: ' bun test ' } },
    )
    expect(out.PostToolUse).toHaveLength(2)
    expect(out.PostToolUse?.[1]).toEqual({
      matcher: 'Edit|Write|NotebookEdit',
      hooks: [
        { type: 'command', command: 'bun run lint' },
        { type: 'command', command: 'bun test' },
      ],
    })
  })
  test('no-op when unset or empty', () => {
    const hooks = { Stop: [] } as any
    expect(withPostEditChecks(hooks, {})).toBe(hooks)
    expect(withPostEditChecks(hooks, { postEditChecks: { lint: '  ' } })).toBe(
      hooks,
    )
  })
})
