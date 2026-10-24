import { describe, expect, test } from 'bun:test'
import {
  createAssistantMessage,
  createUserMessage,
  normalizeMessagesForAPI,
} from '../messages'
import type { AssistantMessage } from '../../types/message'
import {
  buildResponsesRequest,
  messagesWithResponsesState,
} from '../../services/api/openai/responsesAdapter.js'
import { asSystemPrompt } from '@ant/model-provider'

// Runs via `bun run test:chatgpt` (--isolate): depends on real growthbook/microCompact,
// which other files replace with process-global mock.module.
function makeAssistantMsg(
  contentBlocks: Array<{ type: string; text?: string; [key: string]: any }>,
): AssistantMessage {
  return createAssistantMessage({
    content: contentBlocks as any,
  })
}

describe('normalizeMessagesForAPI', () => {
  test('actual microcompaction clears old tool output while retaining opaque ChatGPT reasoning', async () => {
    const { resetGrowthBook } = await import(
      '../../services/analytics/growthbook.js'
    )
    const { microcompactMessages, TIME_BASED_MC_CLEARED_MESSAGE } =
      await import('../../services/compact/microCompact.js')
    const savedUserType = process.env.USER_TYPE
    const savedOverrides = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
    try {
      process.env.USER_TYPE = 'ant'
      process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
        tengu_slate_heron: {
          enabled: true,
          gapThresholdMinutes: 1,
          keepRecent: 1,
        },
      })
      resetGrowthBook()
      const assistants = ['old', 'recent'].map(suffix => {
        const assistant = makeAssistantMsg([
          {
            type: 'tool_use',
            id: `call_${suffix}`,
            name: 'Read',
            input: { file_path: `/fixture-${suffix}.txt` },
          },
        ])
        assistant.timestamp = new Date(Date.now() - 120 * 60_000).toISOString()
        assistant.message.chatgptResponses = {
          accountKey: 'test-account',
          model: 'test-model',
          responseId: `resp_${suffix}`,
          output: [
            {
              type: 'reasoning',
              id: `rs_${suffix}`,
              encrypted_content: `opaque-${suffix}`,
              summary: [],
            },
            {
              type: 'function_call',
              call_id: `call_${suffix}`,
              name: 'Read',
              namespace: 'local_tools',
              arguments: JSON.stringify({
                file_path: `/fixture-${suffix}.txt`,
              }),
            },
          ],
        }
        return assistant
      })
      const result = await microcompactMessages(
        [
          createUserMessage({ content: 'Read two fixture files.' }),
          assistants[0]!,
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_old',
                content: 'OLD_OUTPUT_MUST_NOT_RETURN',
              },
            ],
          }),
          assistants[1]!,
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_recent',
                content: 'recent fixture contents',
              },
            ],
          }),
        ],
        undefined,
        'repl_main_thread',
      )
      expect(result.clearedToolUseIds).toEqual(['call_old'])
      const request = buildResponsesRequest({
        model: 'test-model',
        accountKey: 'test-account',
        messages: messagesWithResponsesState(
          normalizeMessagesForAPI(result.messages),
          asSystemPrompt(['Use local tools.']),
        ),
        tools: [],
        toolChoice: undefined,
        promptCacheKey: 'test-session',
      })
      expect(request.input).toContainEqual({
        type: 'function_call_output',
        call_id: 'call_old',
        output: TIME_BASED_MC_CLEARED_MESSAGE,
      })
      expect(request.input).toContainEqual({
        type: 'function_call_output',
        call_id: 'call_recent',
        output: 'recent fixture contents',
      })
      expect(JSON.stringify(request)).not.toContain(
        'OLD_OUTPUT_MUST_NOT_RETURN',
      )
      expect(JSON.stringify(request)).toContain('opaque-old')
      expect(JSON.stringify(request)).toContain('opaque-recent')
    } finally {
      if (savedUserType === undefined) delete process.env.USER_TYPE
      else process.env.USER_TYPE = savedUserType
      if (savedOverrides === undefined)
        delete process.env.CLAUDE_INTERNAL_FC_OVERRIDES
      else process.env.CLAUDE_INTERNAL_FC_OVERRIDES = savedOverrides
      resetGrowthBook()
    }
  })
})
