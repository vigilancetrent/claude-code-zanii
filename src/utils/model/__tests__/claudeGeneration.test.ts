import { describe, expect, test } from 'bun:test'
import {
  downgradeForcedToolChoice,
  isAdaptiveThinkingClaude,
  isClaude5Generation,
  rejectsDisabledThinking,
  rejectsForcedToolChoice,
  rejectsSamplingParams,
  rejectsThinkingBudget,
} from '../claudeGeneration.js'

describe('claudeGeneration', () => {
  test('recognises the Claude 5 families and nothing older', () => {
    for (const id of [
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-2',
      'us.anthropic.claude-opus-5-5',
    ])
      expect(isClaude5Generation(id)).toBe(true)
    for (const id of [
      'claude-opus-4-7',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022',
      'gpt-6.1-sol',
    ])
      expect(isClaude5Generation(id)).toBe(false)
  })

  test('adaptive thinking starts at Opus 4.6 and Sonnet 4.6', () => {
    expect(isAdaptiveThinkingClaude('claude-opus-4-8')).toBe(true)
    expect(isAdaptiveThinkingClaude('claude-sonnet-4-6')).toBe(true)
    expect(isAdaptiveThinkingClaude('claude-haiku-5-5')).toBe(true)
    expect(isAdaptiveThinkingClaude('claude-opus-4-5-20251101')).toBe(false)
    expect(isAdaptiveThinkingClaude('claude-sonnet-4-5-20250929')).toBe(false)
    expect(isAdaptiveThinkingClaude('claude-haiku-4-5-20251001')).toBe(false)
  })

  test('request rules that return a 400 on the newest models', () => {
    expect(rejectsDisabledThinking('claude-opus-5-5')).toBe(true)
    expect(rejectsDisabledThinking('claude-opus-5')).toBe(false)
    expect(rejectsDisabledThinking('claude-haiku-5-5')).toBe(false)
    expect(rejectsForcedToolChoice('claude-sonnet-5-5')).toBe(true)
    expect(rejectsForcedToolChoice('claude-fable-5-2')).toBe(true)
    expect(rejectsForcedToolChoice('claude-fable-5')).toBe(false)
    expect(rejectsForcedToolChoice('claude-haiku-5-5')).toBe(false)
    expect(rejectsSamplingParams('claude-opus-4-7')).toBe(true)
    expect(rejectsSamplingParams('claude-opus-4-6')).toBe(false)
    expect(rejectsSamplingParams('claude-haiku-4-5-20251001')).toBe(false)
  })

  test('manual thinking budgets are gone from Opus 4.7 on', () => {
    expect(rejectsThinkingBudget('claude-opus-4-7')).toBe(true)
    expect(rejectsThinkingBudget('claude-fable-5-2')).toBe(true)
    expect(rejectsThinkingBudget('claude-haiku-5-5')).toBe(true)
    expect(rejectsThinkingBudget('claude-opus-4-6')).toBe(false)
    expect(rejectsThinkingBudget('claude-haiku-4-5-20251001')).toBe(false)
  })

  test('downgrades forced tool use only where it is rejected', () => {
    const forced = { type: 'tool' as const, name: 'classify' }
    expect(downgradeForcedToolChoice('claude-opus-4-7', forced)).toEqual({
      toolChoice: forced,
    })
    const downgraded = downgradeForcedToolChoice('claude-opus-5-5', forced)
    expect(downgraded.toolChoice).toEqual({ type: 'auto' })
    expect(downgraded.instruction).toContain('classify')
    expect(
      downgradeForcedToolChoice('claude-opus-5-5', { type: 'auto' }),
    ).toEqual({ toolChoice: { type: 'auto' } })
    expect(downgradeForcedToolChoice('claude-opus-5-5', undefined)).toEqual({
      toolChoice: undefined,
    })
  })
})
