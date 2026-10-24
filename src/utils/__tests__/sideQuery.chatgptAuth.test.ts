import { expect, test } from 'bun:test'
import { relative, resolve } from 'path'

// Isolate network/auth mocks from the real authentication and provider tests.
test('ChatGPT auxiliary-query and API-key regressions', async () => {
  const projectRoot = resolve(import.meta.dir, '../../..')
  const runner =
    './' +
    relative(
      projectRoot,
      resolve(import.meta.dir, 'sideQuery.chatgptAuth.isolated.ts'),
    ).replace(/\\/g, '/')
  const child = Bun.spawn([process.execPath, 'test', runner], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual({
    exitCode: 0,
    output: '',
  })
}, 30_000)
