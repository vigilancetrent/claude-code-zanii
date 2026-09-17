import { describe, expect, test } from 'bun:test'
import { OUTPUT_STYLE_CONFIG } from '../outputStyles.js'

describe('built-in output styles', () => {
  test('Concise style exists and keeps coding instructions', () => {
    const concise = OUTPUT_STYLE_CONFIG.Concise
    expect(concise?.source).toBe('built-in')
    expect(concise?.keepCodingInstructions).toBe(true)
    expect(concise?.prompt).toContain('Lead with the result')
  })
})
