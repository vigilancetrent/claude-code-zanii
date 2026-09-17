import { AgentTool } from '@claude-code-best/builtin-tools/tools/AgentTool/AgentTool.js';
import type React from 'react';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import type { AssistantMessage } from '../../types/message.js';
import { logForDebugging } from '../../utils/debug.js';

// Like /fork but without inheriting the conversation: a fresh general-purpose
// agent gets only the prompt. Cheaper, and works with FORK_SUBAGENT off.
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const prompt = args.trim();
  if (!prompt) {
    onDone('Usage: /subtask <prompt>\nExample: /subtask Find every caller of parseConfig and list the files', {
      display: 'system',
    });
    return null;
  }
  const lastAssistantMessage = [...context.messages]
    .reverse()
    .find((m): m is AssistantMessage => m.type === 'assistant');
  if (!lastAssistantMessage || !context.canUseTool) {
    onDone('Cannot start a subtask before the first assistant response.', { display: 'system' });
    return null;
  }
  AgentTool.call(
    {
      prompt,
      description: prompt.slice(0, 40),
      subagent_type: 'general-purpose',
      run_in_background: true,
    },
    context,
    context.canUseTool,
    lastAssistantMessage,
  ).catch(error => {
    logForDebugging(`Subtask agent async error: ${error}`, { level: 'error' });
  });
  onDone(`Subtask started in the background: "${prompt}". Check /list-agents or /tasks.`, { display: 'system' });
  return null;
}
