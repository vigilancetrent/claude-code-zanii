import { expect, test } from 'bun:test'
import { fileURLToPath } from 'url'

test('ChatGPT billing presentation preserves API costs and measured tokens', async () => {
  const child = Bun.spawn(
    [process.execPath, 'test', './src/__tests__/chatgptCost.isolated.ts'],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
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
