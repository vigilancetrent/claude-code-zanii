import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'import',
  description:
    'Import instructions and MCP servers from Cursor, Codex or Copilot into CLAUDE.md / .mcp.json',
  argumentHint: '[cursor|codex|copilot] [--dry-run]',
  supportsNonInteractive: true,
  load: () => import('./import.js'),
} satisfies Command
