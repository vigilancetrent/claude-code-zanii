// Permission decisions of ExecuteExtraTool. Isolated: it needs the real
// permission-rule code, which other test files in the shared process replace
// with a mock (and ExecuteTool.runner.ts replaces src/utils/messages).
import { describe, expect, test } from 'bun:test'
import { ExecuteTool } from '../ExecuteTool.js'

function makeMockTool(name: string) {
  return {
    name,
    call: async () => ({ data: 'ok' }),
    checkPermissions: async () => ({ behavior: 'allow' as const }),
    isEnabled: () => true,
    isMcp: false,
  }
}

describe('ExecuteExtraTool permissions follow the target tool', () => {
  const askOwner = {
    ...makeMockTool('mcp__zanii__ask_owner'),
    isMcp: true,
    mcpInfo: { serverName: 'zanii', toolName: 'ask_owner' },
    // MCP tools do not allow themselves: without a rule they need permission.
    checkPermissions: async () => ({
      behavior: 'passthrough' as const,
      message: 'needs permission',
    }),
  }
  const input = {
    tool_name: 'mcp__zanii__ask_owner',
    params: { question: 'Which greeting?' },
  }
  const contextWith = (
    rules: {
      allow?: string[]
      deny?: string[]
      ask?: string[]
    },
    tools: unknown[] = [askOwner],
  ) =>
    ({
      options: { tools },
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'acceptEdits',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: { cliArg: rules.allow ?? [] },
          alwaysDenyRules: { cliArg: rules.deny ?? [] },
          alwaysAskRules: { cliArg: rules.ask ?? [] },
          isBypassPermissionsModeAvailable: false,
        },
      }),
    }) as never
  const check = (context: never, value = input) =>
    ExecuteTool.checkPermissions(value as never, context)

  test('asks when no rule covers the target', async () => {
    expect((await check(contextWith({}))).behavior).toBe('passthrough')
  })

  test('an allow rule for the target tool allows the call', async () => {
    const result = await check(
      contextWith({ allow: ['mcp__zanii__ask_owner'] }),
    )
    expect(result.behavior).toBe('allow')
  })

  test('an allow rule for another tool does not', async () => {
    const result = await check(contextWith({ allow: ['mcp__zanii__approve'] }))
    expect(result.behavior).toBe('passthrough')
  })

  test('a deny rule for the target tool denies, even with an allow rule', async () => {
    const result = await check(
      contextWith({
        allow: ['mcp__zanii__ask_owner'],
        deny: ['mcp__zanii__ask_owner'],
      }),
    )
    expect(result.behavior).toBe('deny')
  })

  test('an ask rule for the target tool wins over an allow rule', async () => {
    const result = await check(
      contextWith({
        allow: ['mcp__zanii__ask_owner'],
        ask: ['mcp__zanii__ask_owner'],
      }),
    )
    expect(result.behavior).toBe('passthrough')
  })

  test('a target that allows itself needs no prompt, as when called directly', async () => {
    const selfAllowing = makeMockTool('ReadOnlyThing')
    const result = await check(contextWith({}, [selfAllowing]), {
      tool_name: 'ReadOnlyThing',
      params: {},
    } as never)
    expect(result.behavior).toBe('allow')
  })

  test('the target denying its input is a deny', async () => {
    const denying = {
      ...makeMockTool('Picky'),
      checkPermissions: async () => ({
        behavior: 'deny' as const,
        message: 'not this input',
      }),
    }
    const result = await check(contextWith({ allow: ['Picky'] }, [denying]), {
      tool_name: 'Picky',
      params: {},
    } as never)
    expect(result.behavior).toBe('deny')
  })

  test('an unknown target asks; call() then reports it as not found', async () => {
    const result = await check(contextWith({ allow: ['Nope'] }), {
      tool_name: 'Nope',
      params: {},
    } as never)
    expect(result.behavior).toBe('passthrough')
  })
})
