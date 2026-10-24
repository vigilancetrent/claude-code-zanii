import type { Message } from '../types/message.js'

// Mirrors AppState.focusMode for the system prompt (prompts.ts must not
// import the store). /focus writes both.
let focusModeActive = false
export function setFocusModeActive(on: boolean): void {
  focusModeActive = on
}
export function isFocusModeActive(): boolean {
  return focusModeActive
}

function hasText(m: Message): boolean {
  const c = m.message?.content
  if (typeof c === 'string') return c.trim().length > 0
  if (!Array.isArray(c)) return false
  return c.some(
    b =>
      typeof b === 'object' &&
      b !== null &&
      (b as { type?: string }).type === 'text' &&
      String((b as { text?: string }).text ?? '').trim().length > 0,
  )
}

/**
 * /focus view: the last human prompt plus the assistant's text replies since
 * then. Tool calls, tool results, attachments and progress rows are dropped.
 * Falls back to the full list when no prompt is found.
 */
export function focusMessages<T extends Message>(messages: readonly T[]): T[] {
  let start = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.type === 'user' && !m.isMeta && !m.toolUseResult && hasText(m)) {
      start = i
      break
    }
  }
  if (start < 0) return [...messages]
  return messages
    .slice(start)
    .filter((m, i) => i === 0 || (m.type === 'assistant' && hasText(m)))
}
