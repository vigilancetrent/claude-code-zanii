import { afterEach, describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { getGatewayHintHeaders } = await import('../gatewayHints.js')

const boundary = {
  type: 'system',
  subtype: 'compact_boundary',
} as unknown as import('../../../types/message.js').Message

describe('getGatewayHintHeaders', () => {
  const saved = process.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS
    else process.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS = saved
  })

  test('empty unless opted in', () => {
    delete process.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS
    expect(
      getGatewayHintHeaders({ querySource: 'repl_main_thread', messages: [] }),
    ).toEqual({})
  })

  test('emits all four hints when opted in', () => {
    process.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS = '1'
    expect(
      getGatewayHintHeaders({
        querySource: 'compact',
        agentId: 'a1',
        messages: [boundary],
      }),
    ).toEqual({
      'x-claude-code-request-class': 'compact',
      'x-claude-code-agent-type': 'subagent',
      'x-claude-code-compaction': '1',
      'x-claude-code-context-compacted': '1',
    })
    expect(
      getGatewayHintHeaders({ querySource: undefined, messages: [] }),
    ).toEqual({
      'x-claude-code-request-class': 'unknown',
      'x-claude-code-agent-type': 'main',
      'x-claude-code-compaction': '0',
      'x-claude-code-context-compacted': '0',
    })
  })
})
