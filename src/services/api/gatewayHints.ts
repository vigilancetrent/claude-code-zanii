import type { Message } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/**
 * Opt-in routing hints for LLM gateways (upstream 2.1.273 parity).
 * `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` adds:
 *   x-claude-code-request-class     querySource (repl_main_thread, agent:*, compact, auto_mode, …)
 *   x-claude-code-agent-type        main | subagent
 *   x-claude-code-compaction        1 when this request *is* the compaction call
 *   x-claude-code-context-compacted 1 when the conversation has been compacted before
 * A gateway (see model_gateway/gateway.py) can route classifier/subagent
 * traffic to a cheaper model on these alone.
 */
// Inlined (not imported from utils/messages.ts) so test files that partially
// mock that module don't break every provider import.
function hasCompactBoundary(messages: Message[]): boolean {
  return messages.some(
    m => m?.type === 'system' && m.subtype === 'compact_boundary',
  )
}

export function getGatewayHintHeaders(opts: {
  querySource?: string
  agentId?: string
  messages: Message[]
}): Record<string, string> {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS)) return {}
  const source = opts.querySource ?? 'unknown'
  return {
    'x-claude-code-request-class': source,
    'x-claude-code-agent-type': opts.agentId ? 'subagent' : 'main',
    'x-claude-code-compaction': source === 'compact' ? '1' : '0',
    'x-claude-code-context-compacted': hasCompactBoundary(opts.messages)
      ? '1'
      : '0',
  }
}
