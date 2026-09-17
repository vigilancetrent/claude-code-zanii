import { describe, expect, test } from 'bun:test'
import { pickImplicitDefaultMode } from '../autoModeState.js'

describe('pickImplicitDefaultMode', () => {
  const ok = {
    autoCircuitBroken: false,
    autoDisabledBySettings: false,
    isRemote: false,
  }

  test('defaults to auto when nothing blocks it', () => {
    expect(pickImplicitDefaultMode(ok)).toBe('auto')
  })

  test('falls back to default when circuit broken', () => {
    expect(pickImplicitDefaultMode({ ...ok, autoCircuitBroken: true })).toBe(
      'default',
    )
  })

  test('falls back to default when disabled by settings', () => {
    expect(
      pickImplicitDefaultMode({ ...ok, autoDisabledBySettings: true }),
    ).toBe('default')
  })

  test('falls back to default for non-interactive (-p / SDK) sessions', () => {
    expect(pickImplicitDefaultMode({ ...ok, isNonInteractive: true })).toBe(
      'default',
    )
  })

  test('falls back to default in CLAUDE_CODE_REMOTE', () => {
    expect(pickImplicitDefaultMode({ ...ok, isRemote: true })).toBe('default')
  })
})
