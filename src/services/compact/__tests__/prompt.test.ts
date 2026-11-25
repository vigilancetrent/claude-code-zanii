import { mock, describe, expect, test } from 'bun:test'

mock.module('bun:bundle', () => ({ feature: () => false }))

const { formatCompactSummary } = await import('../prompt')

describe('formatCompactSummary', () => {
  test('strips <analysis>...</analysis> block', () => {
    const input =
      '<analysis>my thought process</analysis>\n<summary>the summary</summary>'
    const result = formatCompactSummary(input)
    expect(result).not.toContain('<analysis>')
    expect(result).not.toContain('my thought process')
  })

  test("replaces <summary>...</summary> with 'Summary:\\n' prefix", () => {
    const input = '<summary>key points here</summary>'
    const result = formatCompactSummary(input)
    expect(result).toContain('Summary:')
    expect(result).toContain('key points here')
    expect(result).not.toContain('<summary>')
  })

  test('handles analysis + summary together', () => {
    const input = '<analysis>thinking</analysis><summary>result</summary>'
    const result = formatCompactSummary(input)
    expect(result).not.toContain('thinking')
    expect(result).toContain('result')
  })

  test('handles summary without analysis', () => {
    const input = '<summary>just the summary</summary>'
    const result = formatCompactSummary(input)
    expect(result).toContain('just the summary')
  })

  test('handles analysis without summary', () => {
    const input = '<analysis>just analysis</analysis>and some text'
    const result = formatCompactSummary(input)
    expect(result).not.toContain('just analysis')
    expect(result).toContain('and some text')
  })

  test('collapses multiple newlines to double', () => {
    const input = 'hello\n\n\n\nworld'
    const result = formatCompactSummary(input)
    expect(result).not.toMatch(/\n{3,}/)
  })

  test('trims leading/trailing whitespace', () => {
    const input = '  \n  hello  \n  '
    const result = formatCompactSummary(input)
    expect(result).toBe('hello')
  })

  test('handles empty string', () => {
    expect(formatCompactSummary('')).toBe('')
  })

  test('handles plain text without tags', () => {
    const input = 'just plain text'
    expect(formatCompactSummary(input)).toBe('just plain text')
  })

  test('handles multiline analysis content', () => {
    const input =
      '<analysis>\nline1\nline2\nline3\n</analysis><summary>ok</summary>'
    const result = formatCompactSummary(input)
    expect(result).not.toContain('line1')
    expect(result).toContain('ok')
  })

  test('preserves content between analysis and summary', () => {
    const input =
      '<analysis>thoughts</analysis>middle text<summary>final</summary>'
    const result = formatCompactSummary(input)
    expect(result).toContain('middle text')
    expect(result).toContain('final')
  })
})

describe('compact prompt by model', () => {
  test('older models are still asked for a written <analysis> block', async () => {
    const { getCompactPrompt, getPartialCompactPrompt } = await import(
      '../prompt'
    )
    for (const prompt of [
      getCompactPrompt(),
      getCompactPrompt(undefined, 'claude-opus-4-7'),
      getPartialCompactPrompt(undefined, 'from', 'claude-sonnet-4-6'),
    ]) {
      expect(prompt).toContain('<analysis>')
      expect(prompt).toContain('wrap your analysis in <analysis> tags')
    }
  })

  test('Claude 5 models keep the checklist but write no <analysis> block', async () => {
    const { getCompactPrompt, getPartialCompactPrompt } = await import(
      '../prompt'
    )
    for (const prompt of [
      getCompactPrompt('keep the todo list', 'claude-fable-5-2'),
      getPartialCompactPrompt(undefined, 'from', 'claude-opus-5-5'),
      getPartialCompactPrompt(undefined, 'up_to', 'claude-haiku-5-5'),
    ]) {
      expect(prompt).not.toContain('<analysis>')
      expect(prompt).toContain('in your own reasoning, not in the response')
      // The checklist itself, and the output contract, are unchanged.
      expect(prompt).toContain(
        'Pay special attention to specific user feedback',
      )
      expect(prompt).toContain('<summary>')
      expect(prompt).toContain('a <summary> block')
    }
    expect(
      getCompactPrompt('keep the todo list', 'claude-fable-5-2'),
    ).toContain('keep the todo list')
  })
})
