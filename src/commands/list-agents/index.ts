import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'list-agents',
  description:
    'List subagents, teammates and background workflows this session can message',
  supportsNonInteractive: true,
  load: () => import('./list-agents.js'),
} satisfies Command
