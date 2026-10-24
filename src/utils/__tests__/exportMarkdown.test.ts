import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  renderMessagesToJson,
  renderMessagesToMarkdown,
} from '../exportMarkdown.js'

describe('conversation export', () => {
  test('keeps embedded fences and HTML inside one literal Markdown block', () => {
    const text = 'Before\n```js\nexample()\n```\n````\n<script>data</script>'
    const markdown = renderMessagesToMarkdown(text, '# Title\n<img src=x>')
    expect(markdown).toBe(
      '# \\# Title &lt;img src=x&gt;\n\n`````text\n' + text + '\n`````\n',
    )
  })

  test('exports an empty conversation without an invalid fence', () => {
    expect(renderMessagesToMarkdown('', 'Conversation')).toBe(
      '# Conversation\n\n```text\n\n```\n',
    )
    expect(JSON.parse(renderMessagesToJson([]))).toEqual([])
  })

  test('JSON export preserves transcript and opaque provider metadata', () => {
    const messages = [
      {
        type: 'user',
        message: { role: 'user', content: 'A quoted "prompt"\n' },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Result' }],
          chatgptResponses: {
            accountKey: 'synthetic-account',
            model: 'synthetic-model',
            responseId: 'resp_fixture',
            output: [
              { type: 'reasoning', encrypted_content: 'synthetic-opaque-data' },
            ],
          },
        },
      },
    ] as unknown as Message[]
    expect(JSON.parse(renderMessagesToJson(messages))).toEqual(messages)
  })
})
