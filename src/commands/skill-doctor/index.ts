import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'skill-doctor',
  description:
    'Show loaded skills, their context cost, and which ones you never use',
  supportsNonInteractive: true,
  load: () => import('./skill-doctor.js'),
} satisfies Command
