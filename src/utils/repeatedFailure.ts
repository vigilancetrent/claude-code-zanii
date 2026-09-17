import type { Message } from '../types/message.js'

const REPEAT_THRESHOLD = 3

type Call = { key: string; isError: boolean }

/**
 * Walk the transcript backwards and count how many times the *same* tool
 * call (name + input) just failed in a row. Only the tail matters: any
 * differing call, or a success, resets the streak.
 */
export function trailingIdenticalFailures(messages: readonly Message[]): {
  count: number
  toolName?: string
} {
  const results = new Map<string, boolean>() // tool_use_id → is_error
  const calls: Call[] = []
  for (const m of messages) {
    const c = m.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c as unknown as Array<Record<string, unknown>>) {
      if (m.type === 'user' && b.type === 'tool_result') {
        results.set(String(b.tool_use_id), b.is_error === true)
      }
    }
  }
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const c = m.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c as unknown as Array<Record<string, unknown>>) {
      if (b.type !== 'tool_use') continue
      const isError = results.get(String(b.id))
      if (isError === undefined) continue // still running
      calls.push({ key: `${b.name}:${JSON.stringify(b.input)}`, isError })
    }
  }
  const last = calls.at(-1)
  if (!last?.isError) return { count: 0 }
  let count = 0
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!
    if (!c.isError || c.key !== last.key) break
    count++
  }
  return { count, toolName: last.key.slice(0, last.key.indexOf(':')) }
}

export function repeatedFailureReminder(
  messages: readonly Message[],
): string | null {
  const { count, toolName } = trailingIdenticalFailures(messages)
  if (count < REPEAT_THRESHOLD) return null
  return `The exact same ${toolName} call has now failed ${count} times in a row. Repeating it will not change the result. Read the error, form a different hypothesis, and either try a materially different approach or ask the user with AskUserQuestion. Do not run this call again unchanged.`
}
