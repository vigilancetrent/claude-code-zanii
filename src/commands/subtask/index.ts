import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'subtask',
  description: 'Hand a side task to a background general-purpose subagent',
  argumentHint: '<prompt>',
  load: () => import('./subtask.js'),
} satisfies Command
