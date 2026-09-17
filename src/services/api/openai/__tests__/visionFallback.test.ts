import { describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../../tests/mocks/log'
import { debugMock } from '../../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { coerceStreamErrorBody } = await import('../client.js')
const { stripImageBlocks } = await import('../index.js')

const streamingInit = { body: JSON.stringify({ model: 'x', stream: true }) }

describe('coerceStreamErrorBody', () => {
  test('HTTP 200 + JSON error body on a streaming request becomes a real 4xx', async () => {
    const res = new Response(
      JSON.stringify({
        error: { message: 'glm is not a multimodal model', code: 400 },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
    const out = await coerceStreamErrorBody(res, streamingInit)
    expect(out.status).toBe(400)
    expect(await out.text()).toContain('not a multimodal model')
  })

  test('genuine SSE is replayed byte-for-byte', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'
    const res = new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const out = await coerceStreamErrorBody(res, streamingInit)
    expect(out.status).toBe(200)
    expect(await out.text()).toBe(sse)
  })

  test('non-streaming requests and real errors are untouched', async () => {
    const res400 = new Response('{"error":{"message":"x"}}', { status: 400 })
    expect(await coerceStreamErrorBody(res400, streamingInit)).toBe(res400)
    const plain = new Response('{"error":{"message":"x"}}', { status: 200 })
    expect(
      await coerceStreamErrorBody(plain, { body: '{"stream":false}' }),
    ).toBe(plain)
  })
})

describe('stripImageBlocks', () => {
  test('replaces image blocks with a note and counts them', () => {
    const msgs = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'image', source: {} },
          ],
        },
      },
      { type: 'assistant', message: { role: 'assistant', content: 'ok' } },
    ] as any
    const { messages, stripped } = stripImageBlocks(msgs, 'qwen')
    expect(stripped).toBe(1)
    const block = (messages[0] as any).message.content[1]
    expect(block.type).toBe('text')
    expect(block.text).toContain('qwen does not accept image input')
    expect(messages[1]).toBe(msgs[1])
  })
})
