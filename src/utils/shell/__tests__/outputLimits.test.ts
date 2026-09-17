import { mock, describe, expect, test, afterEach } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug'

// Mock debug.ts to cut the bootstrap/state dependency chain
mock.module('src/utils/debug.ts', debugMock)

const {
  getMaxOutputLength,
  resolveOutputLimit,
  BASH_MAX_OUTPUT_UPPER_LIMIT,
  BASH_MAX_OUTPUT_DEFAULT,
} = await import('../outputLimits')

describe('resolveOutputLimit', () => {
  test('setting beats env', () => {
    expect(resolveOutputLimit(40_000, 'X', '50000', 30_000, 150_000)).toBe(
      40_000,
    )
  })

  test('setting is clamped to upper limit', () => {
    expect(resolveOutputLimit(999_999, 'X', undefined, 30_000, 150_000)).toBe(
      150_000,
    )
  })

  test('falls back to env when setting absent or invalid', () => {
    expect(resolveOutputLimit(undefined, 'X', '50000', 30_000, 150_000)).toBe(
      50_000,
    )
    expect(resolveOutputLimit(-5, 'X', '50000', 30_000, 150_000)).toBe(50_000)
    expect(resolveOutputLimit('abc', 'X', undefined, 30_000, 150_000)).toBe(
      30_000,
    )
  })
})

describe('outputLimits constants', () => {
  test('BASH_MAX_OUTPUT_UPPER_LIMIT is 150000', () => {
    expect(BASH_MAX_OUTPUT_UPPER_LIMIT).toBe(150_000)
  })

  test('BASH_MAX_OUTPUT_DEFAULT is 30000', () => {
    expect(BASH_MAX_OUTPUT_DEFAULT).toBe(30_000)
  })
})

describe('getMaxOutputLength', () => {
  const saved = process.env.BASH_MAX_OUTPUT_LENGTH

  afterEach(() => {
    if (saved === undefined) delete process.env.BASH_MAX_OUTPUT_LENGTH
    else process.env.BASH_MAX_OUTPUT_LENGTH = saved
  })

  test('returns default when env not set', () => {
    delete process.env.BASH_MAX_OUTPUT_LENGTH
    expect(getMaxOutputLength()).toBe(30_000)
  })

  test('returns parsed value when valid', () => {
    process.env.BASH_MAX_OUTPUT_LENGTH = '50000'
    expect(getMaxOutputLength()).toBe(50_000)
  })

  test('caps at upper limit', () => {
    process.env.BASH_MAX_OUTPUT_LENGTH = '999999'
    expect(getMaxOutputLength()).toBe(150_000)
  })

  test('returns default for invalid value', () => {
    process.env.BASH_MAX_OUTPUT_LENGTH = 'not-a-number'
    expect(getMaxOutputLength()).toBe(30_000)
  })

  test('returns default for negative value', () => {
    process.env.BASH_MAX_OUTPUT_LENGTH = '-1'
    expect(getMaxOutputLength()).toBe(30_000)
  })
})
