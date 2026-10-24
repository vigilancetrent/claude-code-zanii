import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'autocompact',
  description: 'Set the context window size auto-compact works against',
  argumentHint: '[auto|<tokens>]',
  supportsNonInteractive: true,
  load: () => import('./autocompact.js'),
} satisfies Command
