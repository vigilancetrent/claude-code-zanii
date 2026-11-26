import { isArtifactsConfigured } from '@claude-code-best/builtin-tools/tools/ArtifactTool/config.js'
import type { Command } from '../../commands.js'

const artifacts = {
  type: 'local-jsx',
  name: 'artifacts',
  description:
    'List HTML artifacts uploaded to cloud-artifacts in this session',
  // Only when the user has set their own artifacts server (config.ts).
  isEnabled: () => isArtifactsConfigured(),
  load: () => import('./artifacts.js'),
} satisfies Command

export default artifacts
