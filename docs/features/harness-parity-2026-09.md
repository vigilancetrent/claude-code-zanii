# v2.12.0 — Harness parity with Claude Code 2.1.274 (+ what the others do better)

CCZ was decompiled from Claude Code ≈2.1.12x. This release closes the gap to upstream **2.1.274** (September 2026) on everything that doesn't require Anthropic's cloud, and adds the mechanisms other harnesses (Hermes, Amp, OpenCode, Aider, Codex) are known for. Research and rationale: [`docs/harness-gap-research-2026-09.md`](../harness-gap-research-2026-09.md). Plan and per-phase log: [`tasks/todo.md`](../../tasks/todo.md).

Everything below works on every provider CCZ supports (Anthropic, Bedrock, Vertex, Foundry, OpenAI-compatible, Gemini, Grok) unless noted.

## Behaviour changes you will notice

| Change | Why | Opt out |
|---|---|---|
| **Auto mode is the default permission mode** in interactive sessions (classifier reviews each tool call; risky ones prompt) | upstream default since 2026-08-14 | `permissions.defaultMode: "default"` or `--permission-mode default`; `-p`/SDK sessions stay explicit |
| **Fork mode on** — `/fork`, implicit forks, all agents run in the background | upstream default since 2026-08-21 | `FEATURE_FORK_SUBAGENT` off at build time |
| **Subagents can spawn subagents** (3 layers) | upstream 2.1.219 | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` or `maxSubagentDepth: 1` |
| **Todo/Task tools not sent to Claude 5+ models** | they track work natively; saves ~2k tokens/turn | `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` |
| `CLAUDE_CODE_SUBAGENT_MODEL` no longer overrides a subagent's own `model:` | upstream precedence: per-call > frontmatter > env > parent | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` |
| `/cost` reports **$0 for unknown OpenAI/Gemini/Grok models** instead of Anthropic's rate | honesty | set `modelPricing` |

## New slash commands

| Command | What it does |
|---|---|
| `/undo` | Revert the last turn's file edits from the checkpoint snapshot; conversation untouched (`/rewind` is the full picker) |
| `/focus` | Show only your latest prompt and the reply; the model is told mid-turn text is invisible |
| `/skill-doctor` | Loaded skills, their per-request token cost, and which you never use |
| `/subtask <prompt>` | Hand a side task to a background general-purpose agent |
| `/list-agents` | Subagents, teammates and workflows you can message (`/send`, `SendMessage`) |
| `/autocompact [auto\|<tokens>]` | Context window auto-compact works against (persisted) |
| `/import cursor\|codex\|copilot [--dry-run]` | `.cursor/rules`, `.cursorrules`, `AGENTS.md`, Copilot instructions → `@imports` in `CLAUDE.md`; Codex `config.toml` MCP servers → `.mcp.json` |
| `/prompt-audit` | Skill: finds dead paths, contradictions and duplicates across CLAUDE.md / rules / skills / agents |
| `/deep-research <question>` | Skill: parallel web-search workflow → cited report |
| `/export file.md` / `file.json` | Markdown export with edits rendered as diffs, or the raw transcript |
| `claude plugin install\|uninstall\|enable\|disable\|update … --json` | One JSON result object for scripting |

## New settings (`settings.json`)

| Key | Type | Purpose |
|---|---|---|
| `bashOutputMaxChars` / `taskOutputMaxChars` | int | Inline output limits (default 30k / 32k, max 150k / 160k) |
| `toolResultMaxChars` | `{toolName: int}` | Per-tool cap before results spill to disk with a preview (MCP tools included) |
| `maxEffortLevel` | `low…max` | Cap on `/effort` for every provider |
| `autoCompactWindow` | int | Same as `/autocompact` |
| `subagentDelegation` | `disabled\|explicit\|proactive` | Remove the Agent tool / spawn only when asked / default |
| `maxSubagentDepth`, `maxConcurrentSubagents` | int | Nesting layers (3) and running-agent cap (20) |
| `modelPricing` | `{model: {input, output, cacheRead?, cacheWrite?}}` | USD per Mtok, exact or prefix match — makes `/cost` right for local models |
| `planModel` | model | Architect/editor split: this model runs in plan mode, the session model executes |
| `repoMap` | bool | Inject a ranked map of exported symbols (CodeGraph) into the prompt |
| `postEditChecks` | `{lint?, test?}` | Commands run after every Edit/Write/NotebookEdit; failures come back to the model |
| `postEditChecks` uses a synthesized `PostToolUse` hook, so it composes with your own hooks | | |

## New environment variables

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` | Send `x-claude-code-request-class` / `-agent-type` / `-compaction` / `-context-compacted` on every request so a gateway can route classifier/subagent traffic to a cheaper model — see [`model_gateway/`](../../model_gateway/README.md) |
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | Same as the settings above |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` | Pin every subagent to `CLAUDE_CODE_SUBAGENT_MODEL` |
| `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1` | Drop the Explore/Plan built-ins |
| `CLAUDE_CODE_ENABLE_TODO_TOOLS=0/1` | Force the todo tools off/on regardless of model |

## Subagents

- `omitClaudeMd: true` frontmatter is now honoured for markdown and `--agents` JSON agents.
- New built-in **`librarian`** agent: read-only, lockfile-aware, answers "how does library X actually work" from the installed package first and the web second, with citations.
- Subagent reports are **scanned**: text imitating harness markup (`<system-reminder>` …) is backslash-escaped and reports that talk about permission modes get a marker line.

## Effort on non-Anthropic providers

`/effort` now maps to `reasoning_effort` (OpenAI Chat Completions), turns DeepSeek/MiMo thinking off on `low`, and sets Gemini `thinkingBudget` (1k / 8k / 24k / 32k / dynamic).

## Hooks

- New **`Interrupt`** event (Esc / Ctrl-C mid-turn): `{reason: "user_cancel", query_in_flight}`.
- Spinner shows `Running <event> hook <name> (Ns)…` once a hook has run ≥ 1 s; **Esc aborts a running SessionStart hook** at startup.

## Bash permission hardening

- `sh -c "…"`, `xargs …`, `find … -exec …` are expanded so the dangerous-`rm` and write-path checks see the inner command; `xargs -I {}` and `$1`/`$@` inside `-c` are treated as unanalyzable.
- `tee` is a write-path command.
- Nested command substitution (`$( … $( … ) … )`, backticks inside `$()`) is **refused in auto mode**, asks elsewhere.

## Terminal UI

- Spinner: `deep in thought` after 45 s of thinking; `Picking the thought back up` while resuming after an output-token limit.
- Vim NORMAL mode: `/` opens the transcript search, `Ctrl+R` redoes.
- MCP: notification when a server disconnects and reconnection gives up (`/mcp`); 401/403 tool errors name the missing OAuth scope.

## System prompt

Aligned with upstream 2.1.274: `# Corrections`, act-when-ready, exploratory-questions, `# Delivering work`, frontend browser verification (when a browser tool is loaded), `# Focus mode` notice, the built-in **Concise** output style, and the Anthropic-internal feedback bullet (Slack channel) replaced with `/feedback` + the repo issue tracker.

## Skill learning (Hermes-style closed loop)

`SKILL_LEARNING` is now compiled into the build. It stays **off** until you run `/skill-learning start`; from then on sessions are observed and reusable skills/agents/commands are proposed from recurring patterns. Observations live on disk; expect them to grow.

## Not done (needs Anthropic infrastructure)

Routines, cloud sessions / self-hosted runners, `/ultrareview`, Claude Tag (Slack), the apps gateway, VS Code panels, `/design*`, `claude plugin eval`, `SubagentHandback`, `WaitForMcpServers`. Claude 5 model tables were deliberately left out of this release.
