import { describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
const { contextLengthFromModelEntry } = await import('../modelCapabilities.js')

describe('contextLengthFromModelEntry', () => {
  test('reads vLLM, llama.cpp, LM Studio and OpenRouter shapes', () => {
    expect(
      contextLengthFromModelEntry({ id: 'a', max_model_len: 202752 }),
    ).toBe(202752)
    expect(
      contextLengthFromModelEntry({
        id: 'b',
        meta: { n_ctx: 262144, n_ctx_train: 262144 },
      }),
    ).toBe(262144)
    expect(
      contextLengthFromModelEntry({ id: 'c', context_length: '32768' }),
    ).toBe(32768)
    expect(
      contextLengthFromModelEntry({
        id: 'd',
        top_provider: { context_length: 131072 },
      }),
    ).toBe(131072)
    expect(contextLengthFromModelEntry({ id: 'e' })).toBeUndefined()
    expect(
      contextLengthFromModelEntry({ id: 'f', max_model_len: 12 }),
    ).toBeUndefined()
  })
})
