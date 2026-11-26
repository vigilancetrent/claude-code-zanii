/**
 * The worker against a real temporary git repository, a fake server and a stand-in agent
 * program. Run: bun test connector/ccz
 * These mirror connector/test_worker.py case by case.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Answer,
  type Config,
  type Json,
  type Order,
  type ServerLike,
  ASK_RULES,
  RULES,
  Server,
  agentEnv,
  autostart,
  buildPrompt,
  git,
  loadConfig,
  progressLine,
  runOrder,
  startAskTools,
  work,
} from '../work.js'

const ORDER: Order = {
  id: '7',
  project: 'Ledger',
  title: 'Fix the rounding',
  instructions: 'Use integer minor units in totals.py.',
  notes: [
    { from: 'them', body: 'Keep the public function names.' },
    { from: 'you', body: 'Reading.' },
  ],
}

/** A stand-in for ccz: reads the prompt, changes a file, speaks in the same event format. */
const AGENT = `
const fs = require('node:fs');
fs.writeFileSync('prompt.txt', fs.readFileSync(0, 'utf8'));
fs.writeFileSync('argv.json', JSON.stringify(process.argv));
fs.writeFileSync('totals.py', 'TOTAL = 4200\\n');
console.log(JSON.stringify({type: 'assistant', message: {content: [{type: 'tool_use', name: 'Edit', input: {file_path: 'totals.py'}}]}}));
console.log('not json, ignored');
console.log(JSON.stringify({type: 'result', result: 'Changed totals.py to integer minor units. Ran nothing.'}));
`
const agent = (script: string) => [process.execPath, '-e', script]

class FakeServer implements ServerLike {
  calls: [string, string, Json | undefined][] = []
  constructor(
    private queued: Json[] = [],
    private holding: string[] = ['7'],
  ) {}

  async call(method: string, path: string, body?: Json): Promise<Answer> {
    this.calls.push([method, path, body])
    if (path === '/v1/agent/heartbeat')
      return [200, { holding: this.holding, beat_seconds: 0.05 }]
    if (path.startsWith('/v1/agent/work?')) return [200, { items: this.queued }]
    if (path.endsWith('/claim')) return [200, ORDER]
    if (method === 'POST' && path.endsWith('/asks'))
      return [201, { id: '5', status: 'waiting' }]
    if (method === 'GET' && path.endsWith('/asks/5')) {
      return [
        200,
        this.answers.length > 1
          ? this.answers.shift()!
          : (this.answers[0] ?? { status: 'waiting' }),
      ]
    }
    return [200, {}]
  }

  /** What the owner answers, one entry per look. The last one stays. */
  answers: Json[] = []

  sent(ending: string): Json[] {
    return this.calls
      .filter(([, path]) => path.endsWith(ending))
      .map(([, , body]) => body ?? {})
  }
}

let cfg: Config
let repo: string

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'zanii-work-'))
  repo = join(root, 'ledger')
  mkdirSync(repo)
  const as = ['-c', 'user.name=t', '-c', 'user.email=t@t']
  spawnSync('git', ['-C', repo, 'init', '-q'])
  writeFileSync(join(repo, 'totals.py'), 'TOTAL = 42.0\n')
  spawnSync('git', ['-C', repo, 'add', '-A'])
  spawnSync('git', ['-C', repo, ...as, 'commit', '-q', '-m', 'totals'])
  cfg = {
    server: 'https://agent.example',
    key: '',
    projects: { ledger: repo },
    command: agent(AGENT),
    testCommands: {},
    maxMinutes: 1,
    worktrees: join(root, 'work'),
    commitAs: ['Zanii', 'info@zanii.agency'],
    asks: false, // on in the tests that are about asking
    askMinutes: 30,
    askPollMs: 20,
  }
})

describe('one work order', () => {
  test('is done in its own copy and handed in with the real diff', async () => {
    cfg.testCommands = { ledger: agent("console.log('1 passed')") }
    const server = new FakeServer()
    expect(await runOrder(cfg, server, ORDER, { stopped: false })).toBe(
      'handed_in',
    )
    const hand = server.sent('/status').at(-1)!
    expect(hand.status).toBe('needs_review')
    expect(hand.result).toBe(
      'Changed totals.py to integer minor units. Ran nothing.',
    )
    const h = hand.handin
    expect(h.branch).toBe('zanii/work-7')
    expect(h.commits).toHaveLength(1)
    expect(h.diff_cut).toBe(false)
    expect(h.files).toContain('totals.py')
    expect(h.diff).toContain('+TOTAL = 4200')
    expect(h.diff).toContain('-TOTAL = 42.0')
    expect(h.tests.startsWith('exit code 0')).toBe(true)
    expect(h.tests).toContain('1 passed')
    // The project folder itself was not touched: the work is on a branch in a separate copy.
    expect(readFileSync(join(repo, 'totals.py'), 'utf8')).toBe('TOTAL = 42.0\n')
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).not.toBe(
      'zanii/work-7',
    )
    expect(server.sent('/notes')).toEqual([{ body: 'Edit: totals.py' }]) // progress reached the server
    // The exact calls and fields the API accepts (api/app/workorders.py: StatusIn, HandIn, NoteIn).
    expect(server.calls.map(([method, path]) => `${method} ${path}`)).toEqual([
      'POST /v1/agent/work/7/status',
      'POST /v1/agent/work/7/notes',
      'POST /v1/agent/work/7/status',
    ])
    expect(server.calls[0]![2]).toEqual({ status: 'in_progress' })
    expect(Object.keys(hand).sort()).toEqual(['handin', 'result', 'status'])
    expect(Object.keys(h).sort()).toEqual([
      'base',
      'branch',
      'commits',
      'diff',
      'diff_cut',
      'files',
      'tests',
    ])
  })

  test("the agent is told the owner's words and the rules, and the server's text never reaches the command line", async () => {
    const hostile = {
      ...ORDER,
      title: 'x --dangerously-skip-permissions',
      instructions: '--permission-mode bypassPermissions',
    }
    await runOrder(cfg, new FakeServer(), hostile, { stopped: false })
    const tree = join(cfg.worktrees, 'work-7')
    const prompt = readFileSync(join(tree, 'prompt.txt'), 'utf8')
    expect(prompt).toContain('--permission-mode bypassPermissions') // as words for the agent, nothing more
    expect(prompt).toContain('Keep the public function names.')
    expect(prompt).toContain('Do not push, merge, deploy')
    expect(prompt).not.toContain('Reading.') // its own old note is not an instruction
    const argv = readFileSync(join(tree, 'argv.json'), 'utf8')
    expect(argv).not.toContain('dangerously')
    expect(argv).not.toContain('bypassPermissions')
  })

  test('a cancel stops the agent and nothing is handed in', async () => {
    cfg.command = agent('setTimeout(() => {}, 60000)')
    const server = new FakeServer()
    const stop = { stopped: false }
    setTimeout(() => {
      stop.stopped = true
    }, 1000)
    const started = Date.now()
    expect(await runOrder(cfg, server, ORDER, stop)).toBe('stopped')
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(
      server.sent('/status').filter(b => b.status === 'needs_review'),
    ).toEqual([])
  }, 30_000)

  test('a failed run is still handed in for a person to judge', async () => {
    cfg.command = agent('process.exit(3)')
    const server = new FakeServer()
    expect(await runOrder(cfg, server, ORDER, { stopped: false })).toBe(
      'handed_in',
    )
    expect(server.sent('/status').at(-1)!.result).toContain('exit code 3')
  })

  test('a program that cannot be started gives the order back with the reason', async () => {
    cfg.command = [join(cfg.worktrees, 'no-such-program'), '-p']
    const server = new FakeServer()
    expect(await runOrder(cfg, server, ORDER, { stopped: false })).toBe(
      'failed',
    )
    expect(server.sent('/notes').at(-1)!.body).toContain('could not be started')
    expect(server.calls.some(([, path]) => path.endsWith('/release'))).toBe(
      true,
    )
  })

  test('the agent never sees the key the worker uses', async () => {
    cfg.key = 'ak_secret_value'
    cfg.command = agent(
      "console.log(JSON.stringify({type:'result',result:['ZANII_CALLS_AGENT_KEY','SOME_OTHER_NAME','HARMLESS'].filter(k => k in process.env).join('|')}))",
    )
    process.env.ZANII_CALLS_AGENT_KEY = 'ak_secret_value'
    process.env.SOME_OTHER_NAME = 'prefix ak_secret_value suffix' // the same key under another name
    process.env.HARMLESS = 'kept'
    try {
      const server = new FakeServer()
      await runOrder(cfg, server, ORDER, { stopped: false })
      expect(server.sent('/status').at(-1)!.result).toBe('HARMLESS')
    } finally {
      delete process.env.ZANII_CALLS_AGENT_KEY
      delete process.env.SOME_OTHER_NAME
      delete process.env.HARMLESS
    }
    expect(agentEnv('ak_x', { A: 'ak_x', B: 'fine', C: undefined })).toEqual({
      B: 'fine',
    })
  })

  test('an id that is not a number is refused before it can become a folder name', async () => {
    const server = new FakeServer()
    expect(
      await runOrder(
        cfg,
        server,
        { ...ORDER, id: '../../etc' },
        { stopped: false },
      ),
    ).toBe('failed')
    expect(server.calls).toEqual([])
    expect(existsSync(cfg.worktrees)).toBe(false)
  })
})

describe('the work loop', () => {
  test('takes only projects that have a folder on this PC, and sends a heartbeat', async () => {
    const server = new FakeServer([
      { id: '9', project: 'Certify', title: 'Not ours' },
      { id: '7', project: 'LEDGER', title: 'Fix the rounding' },
    ])
    await work(cfg, server, { once: true, log: () => {} })
    expect(
      server.calls
        .filter(([, path]) => path.endsWith('/claim'))
        .map(([, path]) => path),
    ).toEqual(['/v1/agent/work/7/claim'])
    expect(
      server.calls.some(([, path]) => path === '/v1/agent/heartbeat'),
    ).toBe(true)
    expect(server.sent('/status').at(-1)!.status).toBe('needs_review')
  })

  test('stops an order the server no longer lists as ours', async () => {
    cfg.command = agent('setTimeout(() => {}, 60000)')
    const gone = new FakeServer(
      [{ id: '7', project: 'Ledger', title: 'Fix the rounding' }],
      [],
    )
    await work(cfg, gone, { once: true, log: () => {} })
    expect(
      gone.sent('/status').filter(b => b.status === 'needs_review'),
    ).toEqual([])
  }, 30_000)
})

describe('small parts', () => {
  test('the prompt and the progress line', () => {
    expect(
      buildPrompt({ id: '1', project: 'P', title: 'T', instructions: 'Do X.' }),
    ).toBe(
      `You are doing one work order for the owner of this project.

Work order #1: T

The owner's instructions:
Do X.

${RULES}`,
    )
    expect(
      progressLine({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '  Looking.\nMore' }] },
      }),
    ).toBe('Looking.')
    expect(
      progressLine({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      }),
    ).toBe('Bash: pnpm test')
    expect(progressLine({ type: 'user' })).toBeNull()
  })

  test('the config refuses a plain http server, a missing key and a folder that is not a repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'zanii-cfg-'))
    const path = join(root, 'worker.json')
    const env = { ZANII_CALLS_AGENT_KEY: 'ak_test' }
    writeFileSync(
      path,
      JSON.stringify({
        server: 'http://agent.example',
        projects: { Ledger: root },
      }),
    )
    expect(() => loadConfig(path, env)).toThrow('https')
    writeFileSync(
      path,
      JSON.stringify({
        server: 'https://agent.example',
        projects: { Ledger: root },
      }),
    )
    expect(() => loadConfig(path, env)).toThrow('git repository')
    expect(() => loadConfig(path, {})).toThrow('no agent key')
    writeFileSync(
      path,
      JSON.stringify({
        server: 'https://agent.example',
        projects: { Ledger: repo },
        command: ['x', '-p'],
        test_commands: { Ledger: ['pnpm', 'test'] },
      }),
    )
    const good = loadConfig(path, env)
    expect(good.projects).toEqual({ ledger: repo })
    expect(good.command).toEqual(['x', '-p'])
    expect(good.testCommands).toEqual({ ledger: ['pnpm', 'test'] })
    expect(good.maxMinutes).toBe(45)
    // Extra flags are added to the command, also to the default one (this same program).
    writeFileSync(
      path,
      JSON.stringify({
        server: 'https://agent.example',
        projects: { Ledger: repo },
        extra_args: ['--allowedTools', 'Bash(pnpm test:*)'],
      }),
    )
    const own = loadConfig(path, env).command
    expect(own[0]).toBe(process.execPath)
    expect(own.slice(-8)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Bash(pnpm test:*)',
    ])
  })
})

describe('the real HTTP client', () => {
  test('sends the key as a bearer token, reads JSON answers and errors, and survives an unreachable server', async () => {
    const seen: {
      auth: string | null
      method: string
      path: string
      body: string
    }[] = []
    const http = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        seen.push({
          auth: req.headers.get('authorization'),
          method: req.method,
          path: url.pathname + url.search,
          body: await req.text(),
        })
        if (url.pathname === '/v1/agent/heartbeat')
          return Response.json({ holding: ['7'], beat_seconds: 20 })
        if (url.pathname === '/broken')
          return new Response('<html>bad gateway</html>', { status: 502 })
        return Response.json(
          { error: { code: 'bad_key', message: 'this key is not valid' } },
          { status: 401 },
        )
      },
    })
    try {
      const server = new Server(`http://localhost:${http.port}/`, 'ak_test')
      expect(
        await server.call('POST', '/v1/agent/heartbeat', { host: 'pc' }),
      ).toEqual([200, { holding: ['7'], beat_seconds: 20 }])
      expect(await server.call('GET', '/v1/agent/work?status=queued')).toEqual([
        401,
        { error: { code: 'bad_key', message: 'this key is not valid' } },
      ])
      expect(await server.call('GET', '/broken')).toEqual([502, {}]) // not JSON: the status still comes through
      expect(seen[0]).toEqual({
        auth: 'Bearer ak_test',
        method: 'POST',
        path: '/v1/agent/heartbeat',
        body: '{"host":"pc"}',
      })
      expect(seen[1]!.path).toBe('/v1/agent/work?status=queued')
    } finally {
      http.stop(true)
    }
    expect(
      await new Server('http://localhost:1', 'ak_test').call('GET', '/x'),
    ).toEqual([0, {}])
  })
})

describe('the agent asks the owner', () => {
  const rpc = async (
    tools: { url: string; token: string },
    method: string,
    params?: Json,
    token = tools.token,
  ) => {
    const r = await fetch(tools.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return {
      status: r.status,
      body: r.status === 200 ? ((await r.json()) as Json) : {},
    }
  }
  const callTool = async (
    tools: { url: string; token: string },
    name: string,
    args: Json,
  ) =>
    (await rpc(tools, 'tools/call', { name, arguments: args })).body.result
      .content[0].text as string

  test('the tool server speaks the protocol, and only to the holder of the run secret', async () => {
    const tools = await startAskTools(cfg, new FakeServer(), '7', {
      stopped: false,
    })
    try {
      expect(tools.url.startsWith('http://127.0.0.1:')).toBe(true) // this PC only
      expect((await rpc(tools, 'initialize', {}, 'wrong')).status).toBe(401)
      const hello = await rpc(tools, 'initialize', {
        protocolVersion: '2025-06-18',
      })
      expect(hello.body.result.protocolVersion).toBe('2025-06-18')
      expect(hello.body.result.capabilities).toEqual({ tools: {} })
      const listed = (await rpc(tools, 'tools/list')).body.result.tools.map(
        (t: Json) => t.name,
      )
      expect(listed).toEqual(['ask_owner', 'approve'])
      const note = await fetch(tools.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tools.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      })
      expect(note.status).toBe(202)
      expect(JSON.parse(tools.agentArgs[1]!).mcpServers.zanii.url).toBe(
        tools.url,
      )
      expect(tools.agentArgs.slice(2)).toEqual([
        '--permission-prompt-tool',
        'mcp__zanii__approve',
      ])
    } finally {
      await tools.close()
    }
  })

  test("a question is passed on, the agent waits, and gets the owner's words", async () => {
    const server = new FakeServer()
    server.answers = [
      { status: 'waiting' },
      { status: 'waiting' },
      { status: 'answered', answer: 'Half even, like the bank does.' },
    ]
    const tools = await startAskTools(cfg, server, '7', { stopped: false })
    try {
      expect(
        await callTool(tools, 'ask_owner', {
          question: 'Round half up or half even?',
        }),
      ).toBe('The owner answered: Half even, like the bank does.')
      expect(server.sent('/asks')).toEqual([
        {
          kind: 'question',
          body: 'Round half up or half even?',
          detail: undefined,
        },
      ])
      expect(
        server.calls.filter(
          ([method, path]) => method === 'GET' && path.endsWith('/asks/5'),
        ),
      ).toHaveLength(3)
      expect(tools.waitedMs()).toBeGreaterThan(0)
    } finally {
      await tools.close()
    }
  })

  test('an action that needs permission goes to the owner: yes lets it run, no stops it', async () => {
    const server = new FakeServer()
    const tools = await startAskTools(cfg, server, '7', { stopped: false })
    try {
      const input = { command: 'pnpm install --frozen-lockfile' }
      server.answers = [{ status: 'answered', approved: true }]
      expect(
        JSON.parse(
          await callTool(tools, 'approve', {
            tool_name: 'Bash',
            input,
            tool_use_id: 't1',
          }),
        ),
      ).toEqual({
        behavior: 'allow',
        updatedInput: input,
      })
      expect(server.sent('/asks')[0]).toEqual({
        kind: 'approval',
        body: 'Bash: pnpm install --frozen-lockfile',
        detail: { tool: 'Bash', input },
      })
      server.answers = [
        {
          status: 'answered',
          approved: false,
          answer: 'Do not delete the build folder.',
        },
      ]
      expect(
        JSON.parse(
          await callTool(tools, 'approve', {
            tool_name: 'Bash',
            input: { command: 'rm -rf build' },
          }),
        ),
      ).toEqual({
        behavior: 'deny',
        message: 'The owner said no: Do not delete the build folder.',
      })
    } finally {
      await tools.close()
    }
  })

  test('a push is refused here without asking anyone, and no answer in time is a no', async () => {
    const server = new FakeServer()
    cfg.askMinutes = 0.002 // about a tenth of a second
    const tools = await startAskTools(cfg, server, '7', { stopped: false })
    try {
      for (const command of [
        'git push origin main',
        'cd x && git -c a=b push',
        'GIT PUSH',
      ]) {
        expect(
          JSON.parse(
            await callTool(tools, 'approve', {
              tool_name: 'Bash',
              input: { command },
            }),
          ).behavior,
        ).toBe('deny')
      }
      expect(server.sent('/asks')).toEqual([]) // the owner was never bothered with it
      const late = JSON.parse(
        await callTool(tools, 'approve', {
          tool_name: 'Bash',
          input: { command: 'pnpm build' },
        }),
      )
      expect(late.behavior).toBe('deny')
      expect(late.message).toContain('no answer within')
      expect(
        await callTool(tools, 'ask_owner', { question: 'Anyone there?' }),
      ).toContain('Do not guess')
    } finally {
      await tools.close()
    }
  })

  test('end to end: the agent program reaches the tools it was given and the answer comes back', async () => {
    // A stand-in agent that behaves like ccz here: it reads --mcp-config from its own
    // arguments and calls ask_owner over HTTP, then reports what it was told.
    const script = join(cfg.worktrees, '..', 'asking-agent.cjs')
    mkdirSync(join(cfg.worktrees, '..'), { recursive: true })
    writeFileSync(
      script,
      `
const fs = require('node:fs');
const prompt = fs.readFileSync(0, 'utf8');
const argv = process.argv;
const zanii = JSON.parse(argv[argv.indexOf('--mcp-config') + 1]).mcpServers.zanii;
fetch(zanii.url, {method: 'POST', headers: {...zanii.headers, 'Content-Type': 'application/json'},
  body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'ask_owner', arguments: {question: 'Which currency?'}}})})
  .then(r => r.json())
  .then(j => console.log(JSON.stringify({type: 'result', result: j.result.content[0].text + ' | prompt tool: ' + argv[argv.indexOf('--permission-prompt-tool') + 1] + ' | told about asking: ' + prompt.includes('ask_owner')})));
`,
    )
    cfg.asks = true
    cfg.command = [process.execPath, script]
    const server = new FakeServer()
    server.answers = [
      { status: 'waiting' },
      { status: 'answered', answer: 'AED' },
    ]
    expect(await runOrder(cfg, server, ORDER, { stopped: false })).toBe(
      'handed_in',
    )
    expect(server.sent('/status').at(-1)!.result).toBe(
      'The owner answered: AED | prompt tool: mcp__zanii__approve | told about asking: true',
    )
    expect(buildPrompt(ORDER, true)).toContain(ASK_RULES)
    expect(buildPrompt(ORDER)).not.toContain('ask_owner')
  })
})

describe('starting by itself', () => {
  const slash = (path: string) => path.split('\\').join('/')

  test('on Windows it is one small file in the Startup folder that brings the worker back if it ends', () => {
    const program = [
      'C:/Program Files/nodejs/node.exe',
      'C:/ccz/dist/cli-node.js',
    ]
    const start = autostart(
      'C:/Users/me/worker.json',
      program,
      'win32',
      { APPDATA: 'C:/Users/me/AppData/Roaming' },
      'C:/Users/me',
    )
    expect(slash(start.path)).toBe(
      'C:/Users/me/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/zanii-worker.cmd',
    )
    expect(start.content).toContain(
      '"C:/Program Files/nodejs/node.exe" "C:/ccz/dist/cli-node.js" "work" "',
    )
    expect(start.content).toContain('worker.json"')
    expect(start.content).toContain('goto again') // it comes back a minute after it ends
    expect(start.next).toBe('')
  })

  test('on Linux and macOS it is a user service, with the one command still to run', () => {
    const linux = autostart(
      '/home/me/worker.json',
      ['/usr/bin/node', '/opt/ccz/cli-node.js'],
      'linux',
      {},
      '/home/me',
    )
    expect(slash(linux.path)).toBe(
      '/home/me/.config/systemd/user/zanii-worker.service',
    )
    expect(linux.content).toContain(
      'ExecStart="/usr/bin/node" "/opt/ccz/cli-node.js" "work" "',
    )
    expect(linux.content).toContain('Restart=always')
    expect(linux.next).toBe(
      'systemctl --user enable --now zanii-worker.service',
    )
    const mac = autostart(
      '/Users/me/worker.json',
      ['/usr/local/bin/node', '/opt/ccz/cli-node.js'],
      'darwin',
      {},
      '/Users/me',
    )
    expect(slash(mac.path)).toBe(
      '/Users/me/Library/LaunchAgents/agency.zanii.worker.plist',
    )
    expect(mac.content).toContain('<string>work</string>')
    expect(mac.next).toContain('launchctl load')
  })
})
