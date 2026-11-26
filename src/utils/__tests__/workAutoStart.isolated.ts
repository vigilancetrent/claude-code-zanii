// Isolated: needs the real config-folder helper, which other test files in
// the shared process replace with a mock.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'work-autostart-'))
process.env.CLAUDE_CONFIG_DIR = home

const { autoStartWork, runningWorkerPid, stopWork, workLogPath, workPidPath } =
  await import('../workAutoStart.js')

const config = join(home, 'worker.json')
writeFileSync(config, '{}')

/** A stand-in for spawnCli that records the launch and reports a pid. */
function fakeSpawn(pid: number | undefined) {
  const calls: string[][] = []
  const spawn = ((spec: { args: string[] }) => {
    calls.push(spec.args)
    return { pid, on() {}, unref() {} } as unknown as ChildProcess
  }) as Parameters<typeof autoStartWork>[0]
  return { calls, spawn }
}

beforeEach(() => rmSync(workPidPath(), { force: true }))
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('work auto start', () => {
  test('is off without a config in user settings', () => {
    const { calls, spawn } = fakeSpawn(process.pid)
    expect(autoStartWork(spawn, undefined)).toEqual({ state: 'off' })
    expect(calls).toHaveLength(0)
  })

  test('does not start when the config file is missing', () => {
    const { calls, spawn } = fakeSpawn(process.pid)
    const missing = join(home, 'nope.json')
    expect(autoStartWork(spawn, missing)).toEqual({
      state: 'missing_config',
      config: missing,
    })
    expect(calls).toHaveLength(0)
  })

  test('starts `work <config>` once and leaves a second session alone', () => {
    // This test process stands in for the worker: its pid is alive.
    const first = fakeSpawn(process.pid)
    expect(autoStartWork(first.spawn, config)).toEqual({
      state: 'started',
      pid: process.pid,
      log: workLogPath(),
    })
    expect(first.calls).toHaveLength(1)
    expect(first.calls[0]!.slice(-2)).toEqual(['work', config])
    expect(runningWorkerPid()).toBe(process.pid)

    const second = fakeSpawn(process.pid)
    expect(autoStartWork(second.spawn, config)).toEqual({
      state: 'running',
      pid: process.pid,
    })
    expect(second.calls).toHaveLength(0)
  })

  test('replaces a pid file left by a worker that is gone', () => {
    writeFileSync(workPidPath(), '2147483646') // no such process
    expect(runningWorkerPid()).toBeUndefined()
    const { calls, spawn } = fakeSpawn(process.pid)
    expect(autoStartWork(spawn, config).state).toBe('started')
    expect(calls).toHaveLength(1)
  })

  test('a failed start leaves no pid file behind', () => {
    const { spawn } = fakeSpawn(undefined)
    expect(autoStartWork(spawn, config).state).toBe('failed')
    expect(runningWorkerPid()).toBeUndefined()
    const retry = fakeSpawn(process.pid)
    expect(autoStartWork(retry.spawn, config).state).toBe('started')
  })

  test('stop reports when nothing is running', () => {
    expect(stopWork()).toEqual({ stopped: false })
  })
})
