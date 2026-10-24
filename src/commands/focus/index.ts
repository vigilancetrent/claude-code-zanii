import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'focus',
  supportsNonInteractive: false,
  description:
    'Toggle focus view: show only your latest prompt and the response',
  load: () => import('./focus.js'),
} satisfies Command
