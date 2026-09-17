import { describe, expect, test } from 'bun:test'
import {
  renderMessagesToJson,
  renderMessagesToMarkdown,
} from '../exportMarkdown.js'

const msgs = [
  { type: 'user', message: { role: 'user', content: 'fix the bug' } },
  {
    type: 'user',
    isMeta: true,
    message: { role: 'user', content: '<system-reminder>' },
  },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        {
          type: 'tool_use',
          id: 't1',
          name: 'Edit',
          input: {
            file_path: 'a.ts',
            old_string: 'x = 1',
            new_string: 'x = 2',
          },
        },
        {
          type: 'tool_use',
          id: 't2',
          name: 'Bash',
          input: { command: 'bun test' },
        },
      ],
    },
  },
  {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }],
    },
  },
] as any

describe('renderMessagesToMarkdown', () => {
  test('renders prompt, reply, edit as diff, bash fence, result block; skips meta', () => {
    const md = renderMessagesToMarkdown(msgs, 'T')
    expect(md).toContain('# T')
    expect(md).toContain('## You\n\nfix the bug')
    expect(md).not.toContain('system-reminder')
    expect(md).toContain('## Claude\n\nOn it.')
    expect(md).toContain('```diff\n- x = 1\n+ x = 2\n```')
    expect(md).toContain('```bash\nbun test\n```')
    expect(md).toContain('<details><summary>Result</summary>')
  })
})

describe('renderMessagesToJson', () => {
  test('keeps only user/assistant rows with message bodies', () => {
    const rows = JSON.parse(renderMessagesToJson(msgs))
    expect(rows).toHaveLength(4)
    expect(rows[0].message.content).toBe('fix the bug')
  })
})
