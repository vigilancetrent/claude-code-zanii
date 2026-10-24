import { describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { mineTranscript, formatHarnessReport, mineProject } = await import(
  '../harnessMining.js'
)

function call(id: string, name: string, input: Record<string, unknown>) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  }
}
function result(id: string, isError: boolean, text = 'x') {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          is_error: isError,
          content: text,
        },
      ],
    },
  }
}
function user(text: string) {
  return { type: 'user', message: { content: text } }
}

function fresh() {
  return {
    toolCalls: 0,
    commands: new Map(),
    denied: new Map(),
    streaks: 0,
    corrections: new Map(),
    undoCount: 0,
    interrupted: 0,
  }
}

describe('mineTranscript', () => {
  test('counts failures per tool+command head, denials, streaks, corrections, undo', () => {
    const acc = fresh()
    const rows = [
      call('1', 'Bash', { command: 'npm test --silent' }),
      result('1', true, 'FAIL'),
      call('2', 'Bash', { command: 'npm test --silent' }),
      result('2', true, 'FAIL'),
      call('3', 'Bash', { command: 'npm test --silent' }),
      result('3', true, 'FAIL'),
      user('no, stop doing that'),
      call('4', 'Edit', { file_path: 'a.ts' }),
      result('4', true, "User doesn't want to proceed"),
      call('5', 'Bash', { command: 'ls' }),
      result('5', false),
      user('/undo'),
      user('[Request interrupted by user]'),
    ]
    mineTranscript(rows as any, acc)
    expect(acc.toolCalls).toBe(5)
    expect(acc.commands.get('Bash\u0000npm test --silent')).toEqual({
      failures: 3,
      total: 3,
    })
    expect(acc.streaks).toBe(1)
    expect(acc.denied.get('Edit')).toBe(1)
    expect(acc.corrections.get('no, stop doing that')).toBe(1)
    expect(acc.undoCount).toBe(1)
    expect(acc.interrupted).toBe(1)
  })

  test('different inputs do not form a streak', () => {
    const acc = fresh()
    mineTranscript(
      [
        call('1', 'Bash', { command: 'a' }),
        result('1', true),
        call('2', 'Bash', { command: 'b' }),
        result('2', true),
        call('3', 'Bash', { command: 'c' }),
        result('3', true),
      ] as any,
      acc,
    )
    expect(acc.streaks).toBe(0)
  })
})

describe('formatHarnessReport / mineProject', () => {
  test('empty project renders "none" sections and never throws', () => {
    const r = mineProject('/definitely/not/a/real/project/dir')
    expect(r.sessions).toBe(0)
    const text = formatHarnessReport(r)
    expect(text).toContain('Sessions mined: 0')
    expect(text.match(/none/g)?.length).toBe(3)
  })
})
