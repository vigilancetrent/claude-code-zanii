/**
 * `ccz work`: the Zanii Calls worker. It runs on the PC where the code is, takes work
 * orders from the server and lets a coding agent do each one in a separate git worktree.
 *
 * Who decides what:
 * - This PC decides the folder, the command and its permissions. They come from the local
 *   config file and nowhere else. The server only supplies the words of the work order.
 * - The agent's text goes in on standard input. Nothing from the server ever becomes a
 *   command-line argument, an environment variable or a tool setting.
 * - The agent runs as a SEPARATE process. This supervisor holds the server key (the agent
 *   never gets it), enforces the time limit, can stop the agent, and reads what changed
 *   from git itself, so the hand-in says what really changed and not what the agent claims.
 * - It never pushes, merges or deploys. A person reviews the hand-in on the server.
 * - The agent can ask the owner a question, and actions it is not allowed by itself are
 *   sent to the owner for a yes or a no. Both go through a small tool server that only
 *   this PC can reach, and the agent waits for the answer.
 *
 * Node and Bun built-ins only. The Python twin is connector/zanii_worker.py: the API's
 * contract test runs that one, so change both together.
 * ponytail: one order at a time. Run a second copy with its own key for a second lane.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { homedir, hostname } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

export const VERSION = '1'
const DIFF_MAX = 200_000
const TEXT_MAX = 20_000
const TESTS_MAX = 20_000
const AGENT_FLAGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'acceptEdits',
]
export const RULES = `Rules for this job:
- Work only inside the current folder. It is a separate copy of the project for this job.
- Do not push, merge, deploy, publish or delete branches. A person reviews your work first.
- Do not read or print secret files (.env files, key files, folders named secret or secrets).
- If something you need is missing or the instructions cannot be followed, stop and say exactly what is missing. Do not guess.
- End with a short report: what you changed, in which files, and how you checked it.`
export const ASK_RULES = `- If you need a decision or a fact that only the owner has, use the ask_owner tool and wait for the answer. Ask one clear question at a time.
- Some actions are sent to the owner for a yes or a no. If one is refused, accept it. Do not try to reach the same result another way.`
/** The worker's own promise, whatever anyone approves: nothing is pushed from here. */
// ponytail: any git command with the word "push" in it, so a commit message that says
// "push" is refused too. The agent then rewords it. Wrong on the safe side.
const NEVER = /\bgit\b[^|;&\n]*\bpush\b/i

export type Json = Record<string, any>
export type Answer = [status: number, body: Json]
/** The calls the worker makes. All go out from this PC; nothing listens here. */
export interface ServerLike {
  call(method: string, path: string, body?: Json): Promise<Answer>
}
export interface Order {
  id: string
  project: string
  title: string
  instructions?: string
  notes?: { from: string; body: string }[]
}
export interface Config {
  server: string
  key: string
  /** Project name in lower case -> folder on this PC. */
  projects: Record<string, string>
  command: string[]
  testCommands: Record<string, string[]>
  maxMinutes: number
  worktrees: string
  commitAs: [name: string, email: string]
  /** Let the agent ask the owner and request approvals. Needs ccz or claude as the agent. */
  asks: boolean
  /** How long the agent waits for the owner's answer before it is told there is none. */
  askMinutes: number
  /** How often the worker looks for the answer. */
  askPollMs: number
}
export interface HandIn {
  branch?: string
  base?: string
  commits?: string[]
  files?: string[]
  diff?: string
  diff_cut?: boolean
  tests?: string
}
/** Set `stopped` and the running agent is ended at the next check, within a second. */
export interface Stop {
  stopped: boolean
}
export type Outcome = 'handed_in' | 'stopped' | 'failed'

export class Server implements ServerLike {
  private readonly base: string
  constructor(
    base: string,
    private readonly key: string,
  ) {
    this.base = base.replace(/\/+$/, '')
  }

  async call(method: string, path: string, body?: Json): Promise<Answer> {
    try {
      const r = await fetch(this.base + path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'User-Agent': `zanii-worker/${VERSION}`,
        },
        signal: AbortSignal.timeout(30_000),
      })
      const text = await r.text()
      try {
        return [r.status, text ? JSON.parse(text) : {}]
      } catch {
        return [r.status, {}]
      }
    } catch {
      return [0, {}] // the server could not be reached; the caller tries again later
    }
  }
}

/** Read and check the local config. Throws with a plain reason when it cannot be used. */
export function loadConfig(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Config {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Json
  let key = env[raw.key_env ?? 'ZANII_CALLS_AGENT_KEY'] ?? ''
  if (!key && raw.key_file)
    key = readFileSync(String(raw.key_file), 'utf8').trim()
  if (!key.startsWith('ak_'))
    throw new Error(
      'no agent key: set ZANII_CALLS_AGENT_KEY, or key_file in the config',
    )
  const server = String(raw.server ?? '')
  if (!server.startsWith('https://') && !server.includes('localhost')) {
    throw new Error('the server address must start with https://')
  }
  const projects: Record<string, string> = {}
  for (const [name, folder] of Object.entries(raw.projects ?? {}))
    projects[name.toLowerCase()] = String(folder)
  const missing = Object.values(projects).filter(
    folder => !existsSync(join(folder, '.git')),
  )
  if (!Object.keys(projects).length || missing.length) {
    throw new Error(
      `every project needs a folder that is a git repository; not one: ${missing.join(', ') || 'no projects listed'}`,
    )
  }
  const testCommands: Record<string, string[]> = {}
  for (const [name, command] of Object.entries(raw.test_commands ?? {}))
    testCommands[name.toLowerCase()] = command as string[]
  return {
    server,
    key,
    projects,
    // "extra_args" adds flags to whichever command is used, for example to allow the agent
    // to run the project's tests, without having to spell out the whole command.
    command: [
      ...(Array.isArray(raw.command) && raw.command.length
        ? raw.command.map(String)
        : selfCommand()),
      ...(Array.isArray(raw.extra_args) ? raw.extra_args.map(String) : []),
    ],
    testCommands,
    maxMinutes: Number(raw.max_minutes ?? 45),
    worktrees: String(raw.worktrees ?? join(homedir(), '.zanii-calls', 'work')),
    commitAs: Array.isArray(raw.commit_as)
      ? [String(raw.commit_as[0]), String(raw.commit_as[1])]
      : ['Zanii', 'info@zanii.agency'],
    asks: raw.asks !== false,
    askMinutes: Number(raw.ask_minutes ?? 30),
    askPollMs: 3000,
  }
}

/** With no command in the config, the agent is the same program that is running `work`. */
export function selfCommand(): string[] {
  return [
    process.execPath,
    ...(process.argv[1] ? [process.argv[1]] : []),
    ...AGENT_FLAGS,
  ]
}

/**
 * On Windows a bare name such as "ccz" is usually a .cmd shim, which cannot be started
 * safely without a shell. Find the real program on the PATH, and refuse a shim with a
 * reason, instead of handing the command line to a shell.
 */
export function resolveProgram(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (
    process.platform !== 'win32' ||
    /[\\/]/.test(name) ||
    /\.[a-z0-9]+$/i.test(name)
  )
    return name
  const folders = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  for (const ext of ['.exe', '.com']) {
    for (const folder of folders)
      if (existsSync(join(folder, name + ext))) return join(folder, name + ext)
  }
  for (const folder of folders) {
    if (
      existsSync(join(folder, `${name}.cmd`)) ||
      existsSync(join(folder, `${name}.bat`))
    ) {
      throw new Error(
        `"${name}" is a script shim on this PC. Give the real program in "command", for example ["node", "C:/path/to/cli-node.js", "-p", ...]`,
      )
    }
  }
  return name
}

export function git(folder: string, ...args: string[]): string {
  const done = spawnSync('git', ['-C', folder, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  })
  if (done.status !== 0)
    throw new Error(
      `git ${args[0]} failed: ${String(done.stderr ?? done.error ?? '')
        .trim()
        .slice(0, 300)}`,
    )
  return String(done.stdout).trim()
}

/**
 * What the agent is told. The instructions were written by the owner on the server. Lines
 * the owner added later are included; the agent's own earlier notes are not instructions.
 */
export function buildPrompt(order: Order, asks = false): string {
  const later = (order.notes ?? [])
    .filter(n => n.from === 'them')
    .map(n => n.body)
  const parts = [
    'You are doing one work order for the owner of this project.',
    `Work order #${order.id}: ${order.title}`,
    `The owner's instructions:\n${order.instructions ?? ''}`,
  ]
  if (later.length)
    parts.push(
      `Later notes from the owner:\n${later.map(n => `- ${n}`).join('\n')}`,
    )
  return [...parts, asks ? `${RULES}\n${ASK_RULES}` : RULES].join('\n\n')
}

export interface AskTools {
  /** Where the agent reaches the tools: an address on this PC only. */
  url: string
  token: string
  /** The extra arguments that make ccz or claude use these tools. */
  agentArgs: string[]
  /** Time the agent spent waiting for the owner. It does not count against the time limit. */
  waitedMs(): number
  close(): Promise<void>
}

/**
 * The tools the agent gets for one order: `ask_owner`, and `approve`, which the agent
 * program calls by itself whenever an action needs permission. This is a tiny tool server
 * (MCP over HTTP) bound to this PC's own address, with a secret that lives for this one
 * run. The agent only ever reaches this; the worker holds the server key and passes the
 * question on.
 */
export async function startAskTools(
  cfg: Config,
  server: ServerLike,
  oid: string,
  stop: Stop,
): Promise<AskTools> {
  const token = randomUUID()
  let waited = 0
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** Post the ask, then wait for the owner. Returns their answer, or why there is none. */
  const waitFor = async (
    kind: 'question' | 'approval',
    body: string,
    detail?: Json,
  ): Promise<Json> => {
    const [status, made] = await server.call(
      'POST',
      `/v1/agent/work/${oid}/asks`,
      { kind, body: body.slice(0, 4000), detail },
    )
    if (status !== 201)
      return {
        none: `the question could not be sent (${made?.error?.message ?? status})`,
      }
    const started = Date.now()
    try {
      while (!stop.stopped && Date.now() - started < cfg.askMinutes * 60_000) {
        await sleep(cfg.askPollMs)
        const [code, ask] = await server.call(
          'GET',
          `/v1/agent/work/${oid}/asks/${made.id}`,
        )
        if (code === 200 && ask.status === 'answered') return ask
        if (code === 200 && ask.status === 'withdrawn')
          return { none: 'this work order was stopped' }
        if (code === 404 || code === 409)
          return { none: 'this work order is no longer ours' }
      }
      return {
        none: stop.stopped
          ? 'this work order was stopped'
          : `no answer within ${cfg.askMinutes} minutes`,
      }
    } finally {
      waited += Date.now() - started
    }
  }

  const askOwner = async (args: Json): Promise<string> => {
    const question = String(args.question ?? '').trim()
    if (!question) return 'Give the question as text.'
    const got = await waitFor('question', question)
    if (got.none)
      return `The owner did not answer: ${got.none}. Do not guess. Stop and say in your report what you needed.`
    return `The owner answered: ${got.answer}`
  }

  const approve = async (args: Json): Promise<string> => {
    const tool = String(args.tool_name ?? 'tool')
    const input: Json =
      args.input && typeof args.input === 'object' ? args.input : {}
    const deny = (message: string) =>
      JSON.stringify({ behavior: 'deny', message })
    if (NEVER.test(String(input.command ?? '')))
      return deny(
        'This worker never pushes. A person does that after reviewing the work.',
      )
    const hint = String(
      input.command ?? input.file_path ?? input.url ?? JSON.stringify(input),
    ).slice(0, 300)
    const text = JSON.stringify(input)
    const detail = {
      tool,
      input:
        text.length <= 7000
          ? input
          : { cut: `${text.slice(0, 6000)} … (too long to show in full)` },
    }
    const got = await waitFor('approval', `${tool}: ${hint}`, detail)
    if (got.none) return deny(`The owner did not approve this: ${got.none}.`)
    if (got.approved !== true)
      return deny(`The owner said no${got.answer ? `: ${got.answer}` : '.'}`)
    return JSON.stringify({ behavior: 'allow', updatedInput: input })
  }

  const tools = [
    {
      name: 'ask_owner',
      description:
        'Ask the owner of this work order one question and wait for the answer. Use it when you need a decision or a fact only they have. It can take a while: they answer from their phone.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'One clear question.' },
        },
        required: ['question'],
      },
    },
    {
      name: 'approve',
      description:
        'Used by the program itself to ask the owner for permission for one action. Do not call it yourself.',
      inputSchema: {
        type: 'object',
        properties: {
          tool_name: { type: 'string' },
          input: { type: 'object' },
          tool_use_id: { type: 'string' },
        },
        required: ['tool_name', 'input'],
      },
    },
  ]

  const answer = async (message: Json): Promise<Json | null> => {
    const reply = (result: Json) => ({ jsonrpc: '2.0', id: message.id, result })
    if (message.id === undefined || message.id === null) return null // a notification: nothing to answer
    switch (message.method) {
      case 'initialize':
        return reply({
          protocolVersion: message.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'zanii-work', version: VERSION },
        })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools })
      case 'tools/call': {
        const name = message.params?.name
        const args: Json = message.params?.arguments ?? {}
        if (name !== 'ask_owner' && name !== 'approve') {
          return reply({
            content: [{ type: 'text', text: 'There is no such tool.' }],
            isError: true,
          })
        }
        return reply({
          content: [
            {
              type: 'text',
              text:
                name === 'ask_owner'
                  ? await askOwner(args)
                  : await approve(args),
            },
          ],
        })
      }
      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'method not found' },
        }
    }
  }

  const http = createServer((req, res) => {
    const send = (code: number, body?: unknown) => {
      res.writeHead(
        code,
        body === undefined ? {} : { 'Content-Type': 'application/json' },
      )
      res.end(body === undefined ? undefined : JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: 'not allowed' })
    if (req.method !== 'POST') return send(405) // no stream of our own to offer
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) req.destroy()
      else chunks.push(chunk)
    })
    req.on('end', async () => {
      try {
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const out = Array.isArray(message)
          ? (await Promise.all(message.map(answer))).filter(Boolean)
          : await answer(message)
        if (out === null || (Array.isArray(out) && !out.length)) send(202)
        else send(200, out)
      } catch {
        send(400, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'not valid JSON' },
        })
      }
    })
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/mcp`
  const config = {
    mcpServers: {
      zanii: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }
  return {
    url,
    token,
    agentArgs: [
      '--mcp-config',
      JSON.stringify(config),
      '--permission-prompt-tool',
      'mcp__zanii__approve',
    ],
    waitedMs: () => waited,
    close: () =>
      new Promise<void>(resolve => {
        http.closeAllConnections?.()
        http.close(() => resolve())
      }),
  }
}

/** One short line of progress from the agent's event stream, or nothing. */
export function progressLine(event: Json): string | null {
  if (event?.type !== 'assistant') return null
  for (const block of event.message?.content ?? []) {
    if (block?.type === 'tool_use') {
      const input = block.input ?? {}
      const hint = String(
        input.file_path ?? input.command ?? input.pattern ?? '',
      ).slice(0, 120)
      return hint
        ? `${block.name ?? 'tool'}: ${hint}`
        : String(block.name ?? 'tool')
    }
    if (block?.type === 'text' && String(block.text ?? '').trim()) {
      return String(block.text).trim().split('\n')[0]!.slice(0, 200)
    }
  }
  return null
}

/**
 * What changed, as git sees it. Anything the agent left uncommitted is committed here on
 * the job's own branch, so the diff and the branch agree.
 */
export function collect(
  tree: string,
  base: string,
  cfg: Config,
  order: Order,
): HandIn {
  git(tree, 'add', '-A')
  if (git(tree, 'status', '--porcelain')) {
    const [name, email] = cfg.commitAs
    const message = `Work order #${order.id}: ${order.title}`.slice(0, 200)
    git(
      tree,
      '-c',
      `user.name=${name}`,
      '-c',
      `user.email=${email}`,
      'commit',
      '-q',
      '-m',
      message,
    )
  }
  const lines = (text: string) => text.split('\n').filter(Boolean)
  const diff = git(tree, 'diff', base, 'HEAD')
  const out: HandIn = {
    branch: git(tree, 'rev-parse', '--abbrev-ref', 'HEAD'),
    base: base.slice(0, 80),
    commits: lines(git(tree, 'rev-list', `${base}..HEAD`)).slice(0, 50),
    files: lines(git(tree, 'diff', '--name-only', base, 'HEAD'))
      .map(f => f.slice(0, 300))
      .slice(0, 500),
    diff: diff.slice(0, DIFF_MAX),
    diff_cut: diff.length > DIFF_MAX,
  }
  const check = cfg.testCommands[order.project.toLowerCase()]
  if (check?.length) {
    try {
      const ran = spawnSync(resolveProgram(check[0]!), check.slice(1), {
        cwd: tree,
        encoding: 'utf8',
        timeout: 900_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      })
      if (ran.error) throw ran.error
      out.tests = `exit code ${ran.status}\n${ran.stdout}${ran.stderr}`.slice(
        -TESTS_MAX,
      )
    } catch (error) {
      out.tests = `the check could not be run: ${String(error)}`.slice(
        0,
        TESTS_MAX,
      )
    }
  }
  return out
}

/** End the agent and everything it started. A plain kill would leave its children running. */
function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
      })
    else process.kill(-pid, 'SIGKILL') // the agent was started as the leader of its own group
  } catch {
    // already gone
  }
}

/** The agent's environment: this PC's, without the key this worker talks to the server with. */
export function agentEnv(
  key: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !(key && value.includes(key))) out[name] = value
  }
  return out
}

/** Do one order that this worker holds. */
export async function runOrder(
  cfg: Config,
  server: ServerLike,
  order: Order,
  stop: Stop,
): Promise<Outcome> {
  const oid = String(order.id)
  if (!/^\d+$/.test(oid)) return 'failed' // the id becomes part of a folder and a branch name
  const repo = cfg.projects[order.project.toLowerCase()]
  if (!repo) return 'failed'
  const tree = join(cfg.worktrees, `work-${oid}`)
  const branch = `zanii/work-${oid}`
  const giveBack = async (why: string): Promise<Outcome> => {
    await server.call('POST', `/v1/agent/work/${oid}/notes`, {
      body: why.slice(0, 2000),
    })
    await server.call('POST', `/v1/agent/work/${oid}/release`)
    return 'failed'
  }

  let base: string
  let program: string
  try {
    base = git(repo, 'rev-parse', 'HEAD')
    if (existsSync(tree)) git(repo, 'worktree', 'remove', '--force', tree) // an earlier try: start clean
    mkdirSync(dirname(tree), { recursive: true })
    git(repo, 'worktree', 'add', '-q', '-B', branch, tree, base)
    program = resolveProgram(cfg.command[0]!)
  } catch (error) {
    return giveBack(
      `Could not prepare a working copy: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await server.call('POST', `/v1/agent/work/${oid}/status`, {
    status: 'in_progress',
  })
  const asks = cfg.asks ? await startAskTools(cfg, server, oid, stop) : null
  const overTime = () => Date.now() > deadline + (asks?.waitedMs() ?? 0) // waiting for the owner is not working time

  let final = ''
  let lastText = ''
  let told = 0
  let exitCode: number | null = null
  let failedToStart = ''
  const deadline = Date.now() + cfg.maxMinutes * 60_000
  const notes: Promise<unknown>[] = []
  const onLine = (line: string) => {
    let event: Json
    try {
      event = JSON.parse(line)
    } catch {
      return // not an event line
    }
    if (event?.type === 'result') final = String(event.result ?? '')
    const note = progressLine(event)
    if (!note) return
    lastText = note
    if (Date.now() - told > 30_000) {
      told = Date.now() // at most one progress line every half minute
      notes.push(
        server.call('POST', `/v1/agent/work/${oid}/notes`, { body: note }),
      )
    }
  }

  await new Promise<void>(resolve => {
    const child = spawn(
      program,
      [...cfg.command.slice(1), ...(asks?.agentArgs ?? [])],
      {
        cwd: tree,
        env: agentEnv(cfg.key),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32', // its own process group, so the whole tree can be ended
      },
    )
    let buffer = ''
    const feed = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let cut = buffer.indexOf('\n')
      while (cut >= 0) {
        onLine(buffer.slice(0, cut))
        buffer = buffer.slice(cut + 1)
        cut = buffer.indexOf('\n')
      }
    }
    const watch = setInterval(() => {
      if (stop.stopped || overTime()) killTree(child.pid)
    }, 1000)
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', error => {
      failedToStart = String(error)
      clearInterval(watch)
      resolve()
    })
    child.on('close', code => {
      if (buffer.trim()) onLine(buffer)
      exitCode = code
      clearInterval(watch)
      resolve()
    })
    child.stdin.on('error', () => {}) // the agent may end before reading everything
    child.stdin.end(buildPrompt(order, asks !== null))
  })
  await Promise.all(notes)
  await asks?.close()
  if (failedToStart)
    return giveBack(`The agent program could not be started: ${failedToStart}`)
  if (stop.stopped) return 'stopped' // cancelled, or the order is no longer ours: say nothing more about it

  let result = final || lastText || 'The agent gave no report.'
  if (overTime()) {
    result = `Stopped after ${cfg.maxMinutes} minutes, the limit set on this PC. Last thing it said: ${result}`
  } else if (exitCode !== 0) {
    result = `The agent program ended with an error (exit code ${exitCode}). Last thing it said: ${result}`
  }
  let handin: HandIn
  try {
    handin = collect(tree, base, cfg, order)
  } catch (error) {
    handin = { branch, base: base.slice(0, 80) }
    result = `${result}\n\nThe changes could not be collected: ${error instanceof Error ? error.message : String(error)}`
  }
  const [status] = await server.call('POST', `/v1/agent/work/${oid}/status`, {
    status: 'needs_review',
    result: result.slice(0, TEXT_MAX),
    handin,
  })
  return status === 200 ? 'handed_in' : 'failed'
}

/** Heartbeat in the background; in front, take one order at a time and do it. */
export async function work(
  cfg: Config,
  server: ServerLike,
  options: {
    once?: boolean
    pauseMs?: number
    log?: (line: string) => void
  } = {},
): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line))
  const current: { id: string | null; stop: Stop } = {
    id: null,
    stop: { stopped: false },
  }
  const said = {
    host: hostname().slice(0, 120),
    program: `zanii-worker ${VERSION} (ccz work)`,
    projects: Object.keys(cfg.projects).sort().slice(0, 50),
  }
  let finished = false
  let wake: (() => void) | null = null
  const sleep = (ms: number) =>
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ms)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })

  const heartbeat = (async () => {
    while (!finished) {
      const [status, answer] = await server.call(
        'POST',
        '/v1/agent/heartbeat',
        said,
      )
      // An order we work on that the server no longer lists as ours was cancelled or taken
      // back: stop. A server that cannot be reached is not a reason to stop.
      const holding: string[] = Array.isArray(answer.holding)
        ? answer.holding
        : []
      if (
        current.id &&
        (status === 403 || (status === 200 && !holding.includes(current.id)))
      )
        current.stop.stopped = true
      if (!finished)
        await sleep(
          status === 200 ? Number(answer.beat_seconds ?? 20) * 1000 : 20_000,
        )
    }
  })()

  try {
    for (;;) {
      const [status, queued] = await server.call(
        'GET',
        '/v1/agent/work?status=queued&limit=50',
      )
      let took: Order | null = null
      for (const item of status === 200 && Array.isArray(queued.items)
        ? queued.items
        : []) {
        if (!cfg.projects[String(item.project).toLowerCase()]) continue // no folder for that project on this PC
        const [code, order] = await server.call(
          'POST',
          `/v1/agent/work/${item.id}/claim`,
        )
        if (code === 200) {
          took = order as Order
          break
        }
      }
      if (took) {
        current.id = String(took.id)
        current.stop = { stopped: false }
        log(`work order #${took.id} (${took.project}): ${took.title}`)
        log(`  -> ${await runOrder(cfg, server, took, current.stop)}`)
        current.id = null
      }
      if (options.once) return
      if (!took)
        await new Promise(resolve =>
          setTimeout(resolve, options.pauseMs ?? 15_000),
        )
    }
  } finally {
    finished = true
    ;(wake as (() => void) | null)?.()
    await heartbeat
  }
}

export interface Autostart {
  /** The file that makes the worker start when the person signs in. */
  path: string
  content: string
  /** What still has to be run once, if anything. */
  next: string
}

/**
 * What to write so the worker starts by itself at sign-in, restarted a minute after it
 * ever ends. One small file per system, removed again by `--uninstall`. Nothing here needs
 * administrator rights. `program` is how this worker was started, so the same one comes back.
 */
export function autostart(
  configPath: string,
  program: string[] = [
    process.execPath,
    ...(process.argv[1] ? [process.argv[1]] : []),
  ],
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Autostart {
  const config = resolve(configPath)
  const run = [...program, 'work', config]
  if (platform === 'win32') {
    const startup = join(
      env.APPDATA ?? join(home, 'AppData', 'Roaming'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
    )
    const line = run.map(part => `"${part}"`).join(' ')
    return {
      path: join(startup, 'zanii-worker.cmd'),
      content: `@echo off\r\ntitle Zanii worker\r\n:again\r\n${line}\r\ntimeout /t 60 /nobreak >nul\r\ngoto again\r\n`,
      next: '',
    }
  }
  if (platform === 'darwin') {
    const args = run
      .map(
        part =>
          `    <string>${part.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`,
      )
      .join('\n')
    const path = join(
      home,
      'Library',
      'LaunchAgents',
      'agency.zanii.worker.plist',
    )
    return {
      path,
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>agency.zanii.worker</string>\n  <key>ProgramArguments</key><array>\n${args}\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>60</integer>\n</dict></plist>\n`,
      next: `launchctl load "${path}"`,
    }
  }
  const quoted = run
    .map(part => `"${part.replace(/(["\\$`])/g, '\\$1')}"`)
    .join(' ')
  return {
    path: join(home, '.config', 'systemd', 'user', 'zanii-worker.service'),
    content: `[Unit]\nDescription=Zanii Calls worker\nAfter=network-online.target\n\n[Service]\nExecStart=${quoted}\nRestart=always\nRestartSec=60\n\n[Install]\nWantedBy=default.target\n`,
    next: 'systemctl --user enable --now zanii-worker.service',
  }
}

/** The body of the `ccz work <config>` command. */
export async function workHandler(options: {
  config: string
  once?: boolean
  install?: boolean
  uninstall?: boolean
}): Promise<void> {
  if (options.uninstall) {
    const file = autostart(options.config).path
    rmSync(file, { force: true })
    console.log(`Removed ${file}. The worker will no longer start by itself.`)
    return
  }
  let cfg: Config
  try {
    cfg = loadConfig(options.config)
    if (options.install) {
      // At sign-in there is no terminal that set the key, so it has to come from a file.
      const raw = JSON.parse(readFileSync(options.config, 'utf8')) as Json
      if (!raw.key_file) {
        throw new Error(
          'to start by itself the worker needs the key in a file: add "key_file" to the config',
        )
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }
  if (options.install) {
    const start = autostart(options.config)
    mkdirSync(dirname(start.path), { recursive: true })
    writeFileSync(start.path, start.content)
    console.log(`Written: ${start.path}`)
    console.log(
      start.next
        ? `Now run once: ${start.next}`
        : 'The worker will start each time you sign in. Start it now with the same command without --install.',
    )
    return
  }
  console.log(
    `zanii-worker ${VERSION}: ${Object.keys(cfg.projects).sort().join(', ')} -> ${cfg.server}`,
  )
  await work(cfg, new Server(cfg.server, cfg.key), { once: options.once })
}
