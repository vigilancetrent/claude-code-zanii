import { expect, test } from 'bun:test';
import { fileURLToPath } from 'url';

test('ChatGPT usage presentation stays isolated from Anthropic utilization', async () => {
  const child = Bun.spawn([process.execPath, 'test', './src/components/Settings/__tests__/chatgptUsage.isolated.tsx'], {
    cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, output: '' });
}, 30_000);
