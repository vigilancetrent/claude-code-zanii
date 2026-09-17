import type { Message } from '../types/message.js'

const RESULT_PREVIEW_CHARS = 1500

type Block = { type: string; [k: string]: unknown }

function blocks(m: Message): Block[] {
  const c = m.message?.content
  if (typeof c === 'string') return c ? [{ type: 'text', text: c }] : []
  return Array.isArray(c) ? (c as unknown as Block[]) : []
}

function fence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body.replace(/```/g, '`​``')}\n\`\`\``
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(b =>
        b && typeof b === 'object' && 'text' in b
          ? String((b as { text: unknown }).text)
          : `[${(b as Block)?.type ?? 'block'}]`,
      )
      .join('\n')
  }
  return ''
}

/** Edit-style inputs render as a diff so the export carries the patch history. */
function renderToolUse(name: string, input: Record<string, unknown>): string {
  if (
    typeof input.old_string === 'string' &&
    typeof input.new_string === 'string'
  ) {
    const minus = input.old_string.split('\n').map(l => `- ${l}`)
    const plus = input.new_string.split('\n').map(l => `+ ${l}`)
    return `**${name}** \`${String(input.file_path ?? '')}\`\n\n${fence('diff', [...minus, ...plus].join('\n'))}`
  }
  if (name === 'Write' && typeof input.content === 'string') {
    return `**${name}** \`${String(input.file_path ?? '')}\`\n\n${fence('', input.content)}`
  }
  if (typeof input.command === 'string') {
    return `**${name}**\n\n${fence('bash', input.command)}`
  }
  return `**${name}**\n\n${fence('json', JSON.stringify(input, null, 2))}`
}

export function renderMessagesToMarkdown(
  messages: readonly Message[],
  title = 'Conversation',
): string {
  const out: string[] = [`# ${title}`, '']
  for (const m of messages) {
    if (m.type !== 'user' && m.type !== 'assistant') continue
    if (m.type === 'user' && m.isMeta) continue
    for (const b of blocks(m)) {
      switch (b.type) {
        case 'text': {
          const text = String(b.text ?? '').trim()
          if (!text) break
          out.push(m.type === 'user' ? '## You' : '## Claude', '', text, '')
          break
        }
        case 'tool_use':
          out.push(
            renderToolUse(
              String(b.name),
              (b.input as Record<string, unknown>) ?? {},
            ),
            '',
          )
          break
        case 'tool_result': {
          const text = resultText(b.content).trim()
          if (!text) break
          const clipped =
            text.length > RESULT_PREVIEW_CHARS
              ? `${text.slice(0, RESULT_PREVIEW_CHARS)}\n… (${text.length - RESULT_PREVIEW_CHARS} more chars)`
              : text
          out.push(
            `<details><summary>Result${b.is_error ? ' (error)' : ''}</summary>`,
            '',
            fence('', clipped),
            '',
            '</details>',
            '',
          )
          break
        }
        default:
          break
      }
    }
  }
  return `${out.join('\n').trimEnd()}\n`
}

/** Raw transcript: user/assistant messages with their API-shaped content. */
export function renderMessagesToJson(messages: readonly Message[]): string {
  const rows = messages
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => ({
      type: m.type,
      uuid: m.uuid,
      timestamp: m.timestamp,
      message: m.message,
    }))
  return `${JSON.stringify(rows, null, 2)}\n`
}
