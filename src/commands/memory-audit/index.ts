import type { Command } from '../../commands.js'

const memoryAudit: Command = {
  type: 'local-jsx',
  name: 'memory-audit',
  description: 'Show Zanii memory provenance (receipts, agent identity)',
  load: () => import('./memoryAudit.js'),
}

export default memoryAudit
