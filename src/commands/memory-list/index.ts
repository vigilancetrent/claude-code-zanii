import type { Command } from '../../commands.js'

const memoryList: Command = {
  type: 'local-jsx',
  name: 'memory-list',
  description: 'List all distilled cross-session memories (L1/L2/L3)',
  load: () => import('./memoryList.js'),
}

export default memoryList
