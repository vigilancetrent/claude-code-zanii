import type { Command } from '../../commands.js'

const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: `Submit feedback about Claude Code`,
  argumentHint: '[report]',
  // Off: the only backend is Anthropic's Claude Code feedback endpoint, which
  // is the wrong place for reports about this fork and rejects other
  // sign-ins. Turn back on when there is a Zanii endpoint to send to.
  isEnabled: () => false,
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
