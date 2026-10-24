import { describe, expect, test } from 'bun:test'
import {
  repeatedFailureReminder,
  trailingIdenticalFailures,
} from '../repeatedFailure.js'

const use = (id: string, name: string, input: unknown) =>
  ({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
  }) as any
const res = (id: string, isError: boolean) =>
  ({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          is_error: isError,
          content: 'x',
        },
      ],
    },
  }) as any

describe('repeated identical failures', () => {
  test('counts a trailing streak of the same failing call', () => {
    const msgs = [
      use('1', 'Bash', { command: 'npm test' }),
      res('1', true),
      use('2', 'Bash', { command: 'npm test' }),
      res('2', true),
      use('3', 'Bash', { command: 'npm test' }),
      res('3', true),
    ]
    expect(trailingIdenticalFailures(msgs)).toEqual({
      count: 3,
      toolName: 'Bash',
    })
    expect(repeatedFailureReminder(msgs)).toContain('failed 3 times in a row')
  })

  test('a different input, a success, or a pending call resets/ignores the streak', () => {
    const differing = [
      use('1', 'Bash', { command: 'a' }),
      res('1', true),
      use('2', 'Bash', { command: 'b' }),
      res('2', true),
      use('3', 'Bash', { command: 'a' }),
      res('3', true),
    ]
    expect(trailingIdenticalFailures(differing).count).toBe(1)
    const success = [
      use('1', 'Bash', { command: 'a' }),
      res('1', true),
      use('2', 'Bash', { command: 'a' }),
      res('2', false),
    ]
    expect(trailingIdenticalFailures(success).count).toBe(0)
    const pending = [
      use('1', 'Bash', { command: 'a' }),
      res('1', true),
      use('2', 'Bash', { command: 'a' }),
    ]
    expect(repeatedFailureReminder(pending)).toBeNull()
  })
})
