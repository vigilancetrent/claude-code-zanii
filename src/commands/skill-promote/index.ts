import type { Command } from '../../commands.js'

const skillPromote = {
  type: 'local',
  name: 'skill-promote',
  description:
    'Promote a skill from project scope to user scope (or demote back)',
  aliases: ['sp'],
  supportsNonInteractive: false,
  load: () => import('./skillPromote.js'),
} satisfies Command

export default skillPromote
