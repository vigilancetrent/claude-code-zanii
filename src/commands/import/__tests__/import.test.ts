import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { planImport, applyImport } = await import('../import.js')

describe('/import', () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ccz-import-'))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  test('cursor: rules become @imports in CLAUDE.md, idempotent', () => {
    mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(cwd, '.cursor', 'rules', 'style.mdc'), 'be terse')
    writeFileSync(join(cwd, '.cursorrules'), 'old style')
    const plan = planImport('cursor', cwd)
    expect(plan.instructionFiles.sort()).toEqual([
      '.cursor/rules/style.mdc',
      '.cursorrules',
    ])
    expect(applyImport('cursor', plan, cwd)).toHaveLength(1)
    const md = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')
    expect(md).toContain('## Imported from cursor')
    expect(md).toContain('@.cursor/rules/style.mdc')
    expect(applyImport('cursor', plan, cwd)).toHaveLength(0)
  })

  test('codex: mcp_servers from config.toml merge into .mcp.json without clobbering', () => {
    mkdirSync(join(cwd, '.codex'))
    writeFileSync(
      join(cwd, '.codex', 'config.toml'),
      '[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "fs-mcp"]\n[mcp_servers.web]\nurl = "https://x/mcp"\n',
    )
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { fs: { command: 'mine' } } }),
    )
    const plan = planImport('codex', cwd)
    expect(Object.keys(plan.mcpServers).sort()).toEqual(['fs', 'web'])
    applyImport('codex', plan, cwd)
    const out = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'))
    expect(out.mcpServers.fs.command).toBe('mine')
    expect(out.mcpServers.web).toEqual({ type: 'http', url: 'https://x/mcp' })
  })

  test('nothing to import', () => {
    const plan = planImport('copilot', cwd)
    expect(plan.instructionFiles).toEqual([])
    expect(applyImport('copilot', plan, cwd)).toEqual([])
  })
})
