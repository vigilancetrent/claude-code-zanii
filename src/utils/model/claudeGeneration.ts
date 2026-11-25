/**
 * Capability rules that follow the Claude model generation instead of a
 * per-model allowlist. Each takes a lowercased model name (a canonical name or
 * a raw ID both work) and is a pure string match, so it is safe to call from
 * module top-level.
 */

// @[MODEL LAUNCH]: A new 5.x point release is covered by these patterns. Only
// a new family name or a changed request rule needs an edit here.

/** Claude 5 families plus Fable/Mythos: 1M context is the default window. */
export function isClaude5Generation(model: string): boolean {
  return /(opus|sonnet|haiku)-5(?!\d)|fable|mythos/.test(model)
}

/** Adaptive thinking, effort and 128K output: Opus 4.6+, Sonnet 4.6+, all of Claude 5. */
export function isAdaptiveThinkingClaude(model: string): boolean {
  return (
    /opus-4-[678](?!\d)|sonnet-4-6(?!\d)/.test(model) ||
    isClaude5Generation(model)
  )
}

/** `thinking: {type: 'enabled', budget_tokens}` returns a 400 (Opus 4.7+). */
export function rejectsThinkingBudget(model: string): boolean {
  return /opus-4-[78](?!\d)/.test(model) || isClaude5Generation(model)
}

/** `thinking: {type: 'disabled'}` returns a 400; omit the field instead. */
export function rejectsDisabledThinking(model: string): boolean {
  return /(opus|sonnet)-5-5(?!\d)|fable|mythos/.test(model)
}

/** `tool_choice` of type `any` / `tool` returns a 400; only `auto` and `none` work. */
export function rejectsForcedToolChoice(model: string): boolean {
  return /(opus|sonnet)-5-5(?!\d)|(fable|mythos)-5-[12](?!\d)/.test(model)
}

/** `temperature` / `top_p` / `top_k` are removed or locked to the default. */
export function rejectsSamplingParams(model: string): boolean {
  return /opus-4-[78](?!\d)/.test(model) || isClaude5Generation(model)
}

type ToolChoiceLike = { type: string; name?: string }

/**
 * Forced tool use is gone on the newest models. Downgrade it to `auto` and
 * return an instruction for the system prompt that keeps the call reliable.
 */
export function downgradeForcedToolChoice<T extends ToolChoiceLike>(
  model: string,
  toolChoice: T | undefined,
): { toolChoice: T | { type: 'auto' } | undefined; instruction?: string } {
  if (
    !toolChoice ||
    (toolChoice.type !== 'tool' && toolChoice.type !== 'any') ||
    !rejectsForcedToolChoice(model.toLowerCase())
  ) {
    return { toolChoice }
  }
  const target = toolChoice.name
    ? `the ${toolChoice.name} tool`
    : 'one of the provided tools'
  return {
    toolChoice: { type: 'auto' },
    instruction: `Respond only by calling ${target}. Do not answer in plain text.`,
  }
}
