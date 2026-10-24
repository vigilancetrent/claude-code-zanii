import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'undo',
  description:
    "Revert the last turn's file edits (conversation is kept); /rewind for the full picker",
  supportsNonInteractive: false,
  load: () => import('./undo.js'),
} satisfies Command
