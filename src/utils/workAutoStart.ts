/**
 * Starts `ccz work` in the background when an interactive session opens, so
 * work orders are taken without the user remembering to start the worker.
 *
 * Opt-in: user settings `workAutoStart` names the worker config file. Only
 * USER settings are read. The worker config decides which command runs and
 * with which permissions, so a project's own settings file must never be
 * able to point it somewhere else.
 *
 * One worker per PC: a pid file in the config folder says which one is
 * running. The worker is detached and outlives the session that started it.
 * ponytail: the pid file is trusted as long as that pid is alive; a pid the
 * OS has reused for another program keeps a new worker from starting until
 * `ccz work-stop` or the file is removed.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { buildCliLaunch, spawnCli } from './cliLaunch.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getSettingsForSource } from './settings/settings.js'

export type WorkAutoStart =
  | { state: 'off' }
  | { state: 'missing_config'; config: string }
  | { state: 'running'; pid: number }
  | { state: 'started'; pid: number; log: string }
  | { state: 'failed'; reason: string }

export function workPidPath(): string {
  return join(getClaudeConfigHomeDir(), 'work.pid')
}

export function workLogPath(): string {
  return join(getClaudeConfigHomeDir(), 'work.log')
}

/** The worker config named in user settings, if any. */
export function workAutoStartConfig(): string | undefined {
  const value = (
    getSettingsForSource('userSettings') as { workAutoStart?: unknown } | null
  )?.workAutoStart
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0: only checks that the process exists
    return true
  } catch (error) {
    // EPERM means it exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The pid in the pid file, when that process is still running. */
export function runningWorkerPid(): number | undefined {
  try {
    const pid = Number(readFileSync(workPidPath(), 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : undefined
  } catch {
    return undefined
  }
}

type Spawn = (
  spec: ReturnType<typeof buildCliLaunch>,
  options: Omit<SpawnOptions, 'windowsHide'>,
) => ChildProcess

/** Start the worker unless it is off, misconfigured or already running. */
export function autoStartWork(
  spawn: Spawn = spawnCli,
  config: string | undefined = workAutoStartConfig(),
): WorkAutoStart {
  if (!config) return { state: 'off' }
  if (!existsSync(config)) return { state: 'missing_config', config }

  const running = runningWorkerPid()
  if (running) return { state: 'running', pid: running }

  const pidPath = workPidPath()
  const logPath = workLogPath()
  let claim: number | undefined
  let log: number | undefined
  try {
    mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
    // A pid file whose process is gone is left over from an earlier worker.
    if (existsSync(pidPath)) unlinkSync(pidPath)
    // 'wx' fails if the file exists: two sessions opening at the same moment
    // cannot both start a worker.
    claim = openSync(pidPath, 'wx')
    log = openSync(logPath, 'a')
    const child = spawn(buildCliLaunch(['work', config]), {
      detached: true,
      stdio: ['ignore', log, log],
    })
    child.on('error', () => {})
    child.unref()
    if (!child.pid) throw new Error('the worker process did not start')
    writeFileSync(claim, String(child.pid))
    return { state: 'started', pid: child.pid, log: logPath }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      // Another session claimed the start a moment ago.
      const other = runningWorkerPid()
      return other
        ? { state: 'running', pid: other }
        : { state: 'failed', reason: 'another session is starting the worker' }
    }
    if (claim !== undefined) {
      try {
        unlinkSync(pidPath)
      } catch {
        // already gone
      }
    }
    return {
      state: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (claim !== undefined) closeSync(claim)
    if (log !== undefined) closeSync(log)
  }
}

/** Stop the background worker and everything it started. */
export function stopWork(): { stopped: boolean; pid?: number } {
  const pid = runningWorkerPid()
  try {
    if (pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
        })
      } else {
        try {
          process.kill(-pid, 'SIGTERM') // detached: it leads its own group
        } catch {
          process.kill(pid, 'SIGTERM')
        }
      }
    }
  } catch {
    // already gone
  }
  try {
    unlinkSync(workPidPath())
  } catch {
    // no pid file
  }
  return pid ? { stopped: true, pid } : { stopped: false }
}
