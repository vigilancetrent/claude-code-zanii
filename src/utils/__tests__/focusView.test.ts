import { describe, expect, test } from 'bun:test'
import { focusMessages } from '../focusView.js'

const u = (text: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'user', message: { role: 'user', content: text }, ...extra }) as any
const a = (blocks: unknown[]) =>
  ({
    type: 'assistant',
    message: { role: 'assistant', content: blocks },
  }) as any

describe('focusMessages', () => {
  test('keeps last prompt and assistant text only', () => {
    const msgs = [
      u('first'),
      a([{ type: 'text', text: 'old reply' }]),
      u('second'),
      a([{ type: 'tool_use', name: 'Bash', input: {} }]),
      u('', {
        toolUseResult: {},
        message: { role: 'user', content: [{ type: 'tool_result' }] },
      }),
      { type: 'attachment', attachment: { type: 'x' } } as any,
      a([{ type: 'text', text: 'final answer' }]),
    ]
    const out = focusMessages(msgs)
    expect(out).toHaveLength(2)
    expect(out[0].message.content).toBe('second')
    expect(out[1].message.content[0].text).toBe('final answer')
  })

  test('skips meta user messages when finding the prompt', () => {
    const msgs = [
      u('real'),
      u('<reminder>', { isMeta: true }),
      a([{ type: 'text', text: 'r' }]),
    ]
    expect(focusMessages(msgs)[0].message.content).toBe('real')
  })

  test('returns everything when no prompt exists', () => {
    const msgs = [a([{ type: 'text', text: 'hi' }])]
    expect(focusMessages(msgs)).toHaveLength(1)
  })
})

describe('focus mode flag for the system prompt', () => {
  test('setFocusModeActive toggles isFocusModeActive', async () => {
    const { isFocusModeActive, setFocusModeActive } = await import(
      '../focusView.js'
    )
    expect(isFocusModeActive()).toBe(false)
    setFocusModeActive(true)
    expect(isFocusModeActive()).toBe(true)
    setFocusModeActive(false)
  })
})
