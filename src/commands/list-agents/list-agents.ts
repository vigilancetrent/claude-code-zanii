import type { TaskState } from '../../tasks/types.js'
import type { LocalCommandCall } from '../../types/command.js'

type Row = { name: string; kind: string; status: string; detail: string }

export function agentRows(tasks: Record<string, TaskState>): Row[] {
  const rows: Row[] = []
  for (const t of Object.values(tasks)) {
    switch (t.type) {
      case 'local_agent':
        rows.push({
          name: t.agentId,
          kind: `agent:${t.agentType}`,
          status: t.status,
          detail: t.description,
        })
        break
      case 'in_process_teammate':
        rows.push({
          name: t.identity.agentName,
          kind: 'teammate',
          status: t.status,
          detail: t.description,
        })
        break
      case 'remote_agent':
      case 'local_workflow':
        rows.push({
          name: t.id,
          kind: t.type === 'remote_agent' ? 'remote' : 'workflow',
          status: t.status,
          detail: t.description,
        })
        break
      default:
        break
    }
  }
  return rows.sort((a, b) => a.status.localeCompare(b.status))
}

export function formatAgentRows(rows: Row[]): string {
  if (rows.length === 0) {
    return 'No agents. Spawn one with /subtask <prompt> or the Agent tool.'
  }
  const w = Math.max(...rows.map(r => r.name.length))
  return [
    `${rows.length} agent(s) — message one with SendMessage / /send <name>:`,
    ...rows.map(
      r =>
        `  ${r.name.padEnd(w)}  ${r.status.padEnd(9)}  ${r.kind.padEnd(16)}  ${r.detail}`,
    ),
  ].join('\n')
}

export const call: LocalCommandCall = async (_args, context) => {
  return {
    type: 'text',
    value: formatAgentRows(agentRows(context.getAppState().tasks)),
  }
}
