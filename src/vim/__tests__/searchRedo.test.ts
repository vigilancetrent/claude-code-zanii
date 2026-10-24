import { describe, expect, test } from 'bun:test'
import { Cursor } from '../../utils/Cursor.js'
import { transition, type TransitionContext } from '../transitions.js'

function ctx(overrides: Partial<TransitionContext>): TransitionContext {
  return {
    cursor: Cursor.fromText('abc', 80, 0),
    text: 'abc',
    setText: () => {},
    setOffset: () => {},
    enterInsert: () => {},
    getRegister: () => '',
    setRegister: () => {},
    getLastFind: () => null,
    setLastFind: () => {},
    recordChange: () => {},
    ...overrides,
  }
}

describe('vim NORMAL extras', () => {
  test('`/` calls onSearch, `u` calls onUndo', () => {
    let searched = 0
    let undone = 0
    const c = ctx({ onSearch: () => searched++, onUndo: () => undone++ })
    const r1 = transition({ type: 'idle' }, '/', c)
    if ('execute' in r1 && r1.execute) r1.execute()
    const r2 = transition({ type: 'idle' }, 'u', c)
    if ('execute' in r2 && r2.execute) r2.execute()
    expect(searched).toBe(1)
    expect(undone).toBe(1)
  })
})
