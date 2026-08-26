import type { Command } from '../../commands.js'

const memoryClear: Command = {
  type: 'local-jsx',
  name: 'memory-clear',
  description: 'Clear all distilled cross-session memories (L1/L2/L3)',
  load: () => import('./memoryClear.js'),
}

export default memoryClear
