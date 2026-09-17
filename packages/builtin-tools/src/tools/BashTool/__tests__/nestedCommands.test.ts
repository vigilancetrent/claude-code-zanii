import { describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../../../tests/mocks/log'
import { debugMock } from '../../../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
// Build-time define; the dangerous-rm path reads MACRO.VERSION when logging.
;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

const { checkPathConstraints, expandNestedCommands } = await import(
  '../pathValidation.js'
)
const { parseForSecurityFromAst } = await import('src/utils/bash/ast.js')
const { getParserModule } = await import('src/utils/bash/bashParser.js')
const { getEmptyToolPermissionContext } = await import('src/Tool.js')
const { setOriginalCwd } = await import('src/bootstrap/state.js')

function ast(cmd: string) {
  const root = getParserModule()!.parse(cmd)!
  const r = parseForSecurityFromAst(cmd, root as any)
  if (r.kind !== 'simple') throw new Error(`${cmd}: ${r.kind}`)
  return r.commands
}

const cwd = process.cwd()
setOriginalCwd(cwd)
const ctx = getEmptyToolPermissionContext()

describe('expandNestedCommands', () => {
  test('sh -c exposes the embedded rm', () => {
    const out = expandNestedCommands(ast('sh -c "rm -rf /"')[0]!)
    expect(out).not.toBe('too-complex')
    expect((out as any[]).map(c => c.argv[0])).toEqual(['sh', 'rm'])
  })

  test('positional params inside -c are too complex', () => {
    expect(expandNestedCommands(ast("bash -c 'rm -rf $1' _ /")[0]!)).toBe(
      'too-complex',
    )
  })

  test('xargs and find -exec expose the inner command', () => {
    expect(
      (expandNestedCommands(ast('xargs -0 -n 1 rm -rf')[0]!) as any[])[1]!.argv,
    ).toEqual(['rm', '-rf'])
    const f = expandNestedCommands(
      ast('find / -name x -exec rm -rf {} ;')[0]!,
    ) as any[]
    expect(f[1]!.argv).toEqual(['rm', '-rf', '/'])
  })

  test('plain commands pass through untouched', () => {
    expect((expandNestedCommands(ast('ls -la')[0]!) as any[]).length).toBe(1)
  })
})

describe('checkPathConstraints with nested commands', () => {
  const run = (cmd: string) =>
    checkPathConstraints({ command: cmd } as any, cwd, ctx, false, [], ast(cmd))

  test('sh -c "rm -rf /" is caught as a dangerous removal', () => {
    const r = run('sh -c "rm -rf /"')
    expect(r.behavior).toBe('ask')
    expect((r as { message?: string }).message).toContain('Dangerous rm')
  })

  test('env bash -c with positional rm asks', () => {
    expect(run("env bash -c 'rm -rf $1' _ /").behavior).toBe('ask')
  })

  test('find -exec rm on / asks; tee outside cwd asks', () => {
    expect(run('find / -exec rm -rf {} +').behavior).toBe('ask')
    expect(run('echo x | tee /etc/passwd').behavior).toBe('ask')
  })

  test('nesting does not change the verdict for benign commands', () => {
    // Compare against the un-nested command: the verdict can depend on
    // bootstrap cwd state (other test files reset it), but a wrapper must
    // never make it stricter or looser than the inner command itself.
    expect(run('sh -c "ls -la"').behavior).toBe(run('ls -la').behavior)
    expect(run('find . -name "*.log" -exec cat {} ;').behavior).toBe(
      run('cat .').behavior,
    )
    expect(run('echo x | tee out.txt').behavior).toBe(
      run('touch out.txt').behavior,
    )
  })
})

describe('nested redirects and xargs placeholders', () => {
  // Pass the real top-level redirects so the un-nested control case goes
  // through the same redirect gate the nested one now does.
  const run = (cmd: string) => {
    const cmds = ast(cmd)
    return checkPathConstraints(
      { command: cmd } as any,
      cwd,
      ctx,
      false,
      cmds.flatMap(c => c.redirects),
      cmds,
    )
  }

  test("sh -c '… > file' is checked like a top-level redirect", () => {
    expect(run("sh -c 'echo x > /etc/hosts'").behavior).toBe('ask')
    expect(run("sh -c 'echo x > out.txt'").behavior).toBe(
      run('echo x > out.txt').behavior,
    )
  })

  test('xargs -I {} is unanalyzable', () => {
    expect(expandNestedCommands(ast('xargs -I {} rm -rf {}')[0]!)).toBe(
      'too-complex',
    )
  })
})
