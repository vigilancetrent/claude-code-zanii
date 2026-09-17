# CCZ Harness Gap — Implementation Plan

Source: `docs/harness-gap-research-2026-09.md`. **Claude 5 model IDs are explicitly out of scope** (user decision, 2026-09-17).

Ordering rule: cheapest + highest impact for local/OpenAI-compatible users first. Each phase is one PR, `bun run precheck` green, one regression test per non-trivial change.

---

## Phase 1 — Flip what already exists (SIMPLE, 1 PR)

- [x] **1.1 Auto mode build flags** — `scripts/defines.ts`: add `'BASH_CLASSIFIER'`, `'TREE_SITTER_BASH'` to `DEFAULT_BUILD_FEATURES`. Verify `bun run build` size/RSS unchanged (tree-sitter wasm is lazy).
- [x] **1.2 Auto mode default** — find where default `permissionMode` resolves (`src/utils/permissions/permissionSetup.ts`, `bypassPermissionsKillswitch.ts`); default to `auto` when (a) provider ≠ none and (b) `tengu_auto_mode_config` stub not `disabled`. Keep `--permission-mode default` as opt-out; persist via settings `permissions.defaultMode`.
  - Test: `bun test src/utils/permissions/__tests__/` + new test "defaults to auto when classifier model available".
  - Risk: users on tiny local models get a bad classifier → keep existing circuit breaker (`isAutoModeCircuitBroken`) → falls back to `default` after N failures.
- [x] **1.3 Fork mode** — `scripts/defines.ts`: un-comment `'FORK_SUBAGENT'`. Smoke `/fork` on firstParty + OpenAI provider. If comment "已通过 Agent tool 等效实现" is true, delete `src/commands/fork/` gate instead — pick whichever is the smaller diff after reading `fork.tsx:14`.
- [x] **1.4 Todo/Task tools cost** — `src/tools.ts`: gate `TodoWriteTool`, `TaskCreate/Get/Update/List` behind `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` or model < Opus 4.5 (mirror upstream 2.1.268). Saves ~2K tokens/turn on every request.

## Phase 2 — Output limits for local models (SIMPLE, 1 PR)

- [x] **2.1 `bashOutputMaxChars` / `taskOutputMaxChars` settings** — `src/utils/shell/outputLimits.ts` already reads `BASH_MAX_OUTPUT_LENGTH` env; add settings keys (settings schema + `getMaxOutputLength()` reads setting > env > default), upper bound 128K. Same for TaskOutput.
- [x] **2.2 MCP per-tool output cap** — `src/services/mcp/client.ts`: apply `mcpServers.<name>.maxOutputChars` (default = bash limit) before returning tool_result; spill to disk with preview like Bash does (`utils.ts:101`).
- [x] **2.3 1 GB disk cap** — same spill path: refuse to write > 1 GB, return preview + "truncated at 1 GB".
  - Tests: extend `packages/builtin-tools/src/tools/BashTool/__tests__`, new `mcp/__tests__/outputCap.test.ts`.

## Phase 3 — Effort → provider mapping (STANDARD, 1 PR)

- [x] **3.1** `src/utils/effort.ts` `modelSupportsEffort()` → true for OpenAI/Gemini/Grok providers.
- [x] **3.2** `src/services/api/openai/index.ts` (lines 82–95 already map effort → `reasoning_effort`) — wire `/effort` value through for Chat Completions too, not just Responses adapter; DeepSeek/Qwen: `low` → thinking off, else on.
- [x] **3.3** `src/services/api/gemini/client.ts`: effort → `thinkingConfig.thinkingBudget` (low 1K / medium 8K / high 24K / max unlimited).
- [x] **3.4** `maxEffortLevel` setting — clamp in `resolveAppliedEffort()`; one place, all providers.
  - Tests: unit per adapter, assert request body field.

## Phase 4 — Gateway hint headers + model_gateway routing (SIMPLE, 1 PR)

- [x] **4.1** `src/services/api/client.ts` (or wherever `defaultHeaders` built): when `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, add `x-claude-code-request-class` (`main|subagent|side_query|classifier|compact`), `x-claude-code-agent-type`, `x-claude-code-context-compacted`. `querySource` already exists on cache-control — reuse it.
- [x] **4.2** `model_gateway/gateway.py`: optional `ROUTE_BY_CLASS = {"classifier": "qwen3.8-27b", "subagent": ...}` override before `MODEL_ROUTES` lookup. Keep it a dict; no config file. Commit `model_gateway/` (currently untracked) with a 5-line README section.
  - Test: one `bun test` asserting headers present/absent by env; `python -c` self-check in gateway for route resolution.

## Phase 5 — Missing no-cloud commands (STANDARD, one PR per 2–3 commands)

Each: `src/commands/<name>/{index.ts,<name>.ts}` following `src/commands/effort/` pattern; register in `src/commands.ts`; help text; one test.

- [x] **5.1 `/skill-doctor`** — list loaded skills, bytes/tokens each, last-used turn (from `discoveredToolsThisSession`-style set); flag never-invoked. Pure read of skill registry.
- [x] **5.2 `/subtask [prompt]`** — thin wrapper: spawn `AgentTool` with `subagent_type: general-purpose` in background, return agent name. ~30 lines.
- [x] **5.3 `/list-agents` + `/tasks`** — one command dir, two aliases: dump `AppState` background agents/workflows/monitors table. Reuse `src/commands/job/` renderer if exists.
- [x] **5.4 `/focus`** — toggle AppState flag; `Messages.tsx` renders only last user + last assistant + one-line tool summary when set. Fullscreen only.
- [x] **5.5 `/autocompact [auto|<tokens>]`** — set threshold used by `src/services/compact/` auto trigger; persist to settings.
- [x] **5.6 `/prompt-audit`** — bundled skill (prompt-only, `src/skills/bundled/promptAudit.ts` like `simplify.ts`): read CLAUDE.md + `.claude/rules/*` + skills, flag stale refs (files that no longer exist, commands not in registry), offer edits. Zero runtime code.
- [x] **5.7 `/deep-research <q>`** — bundled workflow script under `WORKFLOW_SCRIPTS`: `parallel(N × WebSearch agents) → synthesize`. Copy the `review-changes` pattern from the Workflow tool doc.
- [x] **5.8 `/import [cursor|codex|copilot] [--dry-run]`** — read `.cursor/rules`, `AGENTS.md`, `.github/copilot-instructions.md`, `codex.toml` MCP block → write to `CLAUDE.md` / `.mcp.json`. Dry-run prints diff.
- [x] **5.9 `claude plugin … --json`** — add `--json` to install/uninstall/update/enable/disable in `src/main.tsx` plugin subcommands; emit `{ok, plugin, errorDetails}`.
  - Skipped: `claude plugin eval` (needs eval-suite format spec — YAGNI until a plugin author asks), `/design*` (Anthropic Design backend), `/usage-credits` (claude.ai).

## Phase 6 — Delegation knobs (SIMPLE, 1 PR)

- [x] **6.1 `agents.subagentDepth`** — done in Phase 11.1 as `maxSubagentDepth` / `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`.
- [x] **6.2 `agents.delegation`**: `disabled | explicit | proactive` — `disabled` removes AgentTool from tool list; `explicit` adds one system-prompt line "only spawn agents when the user asks"; `proactive` = today.
- [x] **6.3 Subagent tokens count toward `/goal` / `TOKEN_BUDGET`** — sum child usage into parent in `QueryEngine` on agent completion.
  - Tests: depth limit unit test; delegation=disabled removes tool from `tools.ts` output.

## Phase 7 — Hook `Interrupt` event + hook progress UI (SIMPLE, 1 PR)

- [x] **7.1** Add `'Interrupt'` to `HOOK_EVENTS` in `src/entrypoints/sdk/coreSchemas.ts`; fire from the Esc/Ctrl-C abort handler in `QueryEngine.ts` with `{reason: 'user_interrupt'}`.
- [x] **7.2** Hook progress row: while a `SessionStart`/`UserPromptSubmit`/`PreToolUse` hook runs > 1 s, show `⟳ hook <name> (Ns)` in the spinner; Esc cancels `SessionStart` hooks. Hook into `AsyncHookRegistry.ts` started/progress events (already emitted per `hookEvents.ts`).

## Phase 8 — MCP SDK bump (STANDARD, 1 PR)

- [x] **8.1** `@modelcontextprotocol/sdk` ^1.29 → latest (2026-07-28 protocol). Run `bun test src/services/mcp`. Fix `listChanged` re-fetch of prompts/resources; add disconnect + "reconnect gave up → see /mcp" notification.
- [x] **8.2** `insufficient_scope` 403 → name missing scopes in the error, point at `/mcp`.

## Phase 9 — Bash permission hardening backports (HIGH risk, 1 PR, manual review)

- [x] **9.1** — done in Phase 12.1 (`hasNestedCommandSubstitution` → deny in auto mode).
- [x] **9.2** `tee` destinations go through `Edit()` deny rules + write-path check.
- [x] **9.3** `rm -rf` detection through `sh -c '…'`, positional params, wildcard in command patterns.
- [x] **9.4** — verified, no code change needed: unsafe `VAR=` prefixes stay in the match string so no allow rule matches (prompts); AST separates envVars so dangerous-rm still fires.
  - Tests: table-driven in `src/utils/permissions/__tests__/bashClassifier.test.ts` — every case above as allow/deny fixture.

## Phase 10 — Export + Vim parity (LOW, 1 PR)

- [x] **10.1** `/export [file.md|file.json]` — markdown with tool-call diffs; JSON = raw transcript. Extend `src/commands/export/`.
- [x] **10.2** — done in Phase 12.2 (`/` search, `Ctrl+R` redo).

---

## Phase 11 — Subagents parity (from research §5, replaces skipped 6.1)

- [x] **11.1** `ToolUseContext.agentDepth` (child = parent+1 in `createSubagentContext`); `getMaxSubagentSpawnDepth()` = env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` > settings `maxSubagentDepth` > 3. `filterToolsForAgent` keeps AgentTool when child depth < max; AgentTool.call throws at/over the limit (forks keep the tool).
- [x] **11.2** `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20): AgentTool.call counts running `local_agent` tasks and errors "Concurrent subagent limit reached".
- [x] **11.3** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` — subagent `model` frontmatter / per-call model ignored (forks + `inherit` skills exempt).
- [x] **11.4** `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`.
- [x] **11.5** `omitClaudeMd` parsed from frontmatter / `--agents` JSON.
- [x] **11.6** Subagent output scanning: backslash-escape `<system-reminder>`-style tags in agent result text; prepend a marker line when the report mentions `bypassPermissions`/`dontAsk`.

## Phase 12 — Previously skipped items

- [x] **12.1** Auto mode refuses nested command substitution (`$(…$(…)…)`, backtick inside `$()`): `deny` when auto mode active, `ask` otherwise.
- [x] **12.2** Vim NORMAL `/` → open transcript search; `Ctrl+R` → redo (prompt history).
- [x] **12.3** Esc cancels a running SessionStart hook at startup (AbortController threaded into `processSessionStartHooks`; Esc aborts; session continues without hook output).

## Phase 13 — System prompt parity (research §6.1)

- [x] **13.1** Replace the `/issue` + `/share` + Slack-channel feedback bullet with `/feedback` + `MACRO.ISSUES_EXPLAINER`.
- [x] **13.2** Add static sections after Communication style: `# Corrections`, act-when-ready, `# Delivering work`, exploratory-questions bullet, frontend-verification bullet (only when a browser tool is loaded).
- [x] **13.3** Focus-mode notice after `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` when `focusMode` is on (module flag set by `/focus`, read by prompts.ts — no store import).
- [x] **13.4** Built-in `Concise` output style (upstream text) in `src/constants/outputStyles.ts`.
- [x] **13.5** Harness lines: "independent tool calls can run in parallel", "hook output = user feedback"; communication lines: "end-of-turn summary 1–2 sentences", "no planning docs unless asked".

## Phase 14 — Terminal UI parity (research §6.2)

- [x] **14.1** Spinner shows `deep in thought` once thinking exceeds 45 s.
- [x] **14.2** Spinner shows `picking the thought back up…` while the query loop resumes after an output-token limit (`CompactProgressEvent: output_limit_resume`).

## Phase 15 — Beat-the-field features (research §7)

- [x] **15.1** Compile in `SKILL_LEARNING` (`scripts/defines.ts`); runtime stays opt-in via `/skill-learning start`.
- [x] **15.2** `/undo` — `fileHistoryRewind` to the last non-meta user message's snapshot; conversation untouched.
- [x] **15.3** `modelPricing` setting (`{model: {input, output, cacheRead?, cacheWrite?}}` per Mtok, prefix match) consulted first in `getModelCosts`; unknown model on a non-Anthropic provider → $0.
- [x] **15.4** `planModel` setting: `getRuntimeMainLoopModel` returns it in plan mode (any provider).
- [x] **15.5** `repoMap: true` setting → post-boundary `# Repository map` section from CodeGraph exported symbols (cap ~1.5k tokens); builds the graph lazily in the background if not indexed.
- [x] **15.6** Built-in `librarian` agent (read-only + web) for library docs/examples.
- [x] **15.7** `postEditChecks: {lint?, test?}` → synthesized PostToolUse hook (matcher `Edit|Write|NotebookEdit`) merged into the hooks snapshot.

## Explicitly not doing

- Claude 5 model IDs / aliases / pricing (user decision).
- Routines, cloud sessions, self-hosted runners, `/ultrareview`, Claude Tag (Slack), apps gateway, VS Code panels, `/design*`, `/usage-credits`, `/passes` — Anthropic infra.
- Fast mode — Anthropic pricing tier, meaningless on other providers.
- `claude plugin eval` — no spec, no demand yet.

## Verification (every phase)

1. `bun run precheck` — zero errors.
2. `bun run build && node dist/cli.js --version` — RSS sanity.
3. Manual: run phase's feature once on firstParty and once on `CLAUDE_CODE_USE_OPENAI=1` against `model_gateway/`.

## Review log (2026-09-17)

| Phase | Shipped | Tests |
|---|---|---|
| 1 | `BASH_CLASSIFIER`, `TREE_SITTER_BASH`, `FORK_SUBAGENT` in build defaults; implicit `auto` permission mode when nothing explicit is set (`pickImplicitDefaultMode`); Todo/Task tools dropped for Claude 5+ ids (`areTodoToolsEnabled`, `CLAUDE_CODE_ENABLE_TODO_TOOLS`) | `autoModeState.test.ts`, `tasks.test.ts` |
| 2 | `bashOutputMaxChars`, `taskOutputMaxChars`, `toolResultMaxChars{}` settings; 1 GB persist cap | `outputLimits.test.ts` |
| 3 | effort → `reasoning_effort` (chat completions), DeepSeek thinking off on `low`, Gemini `thinkingBudget`, `maxEffortLevel` clamp; OpenAI/Gemini report effort support | `thinking.test.ts`, `effort.test.ts` |
| 4 | `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` → 4 `x-claude-code-*` headers on all 4 providers; `model_gateway/gateway.py` `ROUTE_BY_CLASS` + `--check` + README | `gatewayHints.test.ts`, `python gateway.py --check` |
| 5 | `/skill-doctor`, `/subtask`, `/list-agents`, `/focus` (AppState.focusMode + `focusMessages`), `/autocompact` (settings.autoCompactWindow), `/prompt-audit` + `/deep-research` bundled skills, `/import cursor|codex|copilot [--dry-run]`, `claude plugin … --json` | `skillDoctorAndListAgents.test.ts`, `focusView.test.ts`, `import.test.ts`, `pluginsJson.test.ts` |
| 6 | `subagentDelegation: disabled|explicit|proactive` setting (tool removal / prompt note); subagent tokens already flow through `addToTotalSessionCost` → goal budget | — (one-liners) |
| 7 | `Interrupt` hook event (schema + `executeInterruptHooks` from REPL `onCancel`); spinner shows `Running <event> hook <name> (Ns)…` | `interruptHook.test.ts` |
| 8 | `@modelcontextprotocol/sdk` ^1.30.0 (latest stable; 2026-07-28 protocol not yet in a stable TS SDK); disconnect / gave-up notifications pointing at `/mcp`; 403 tool errors name the missing scope | existing mcp suites |
| 9 | `tee` is a `create` path command; `sh -c`, `xargs`, `find -exec` expanded to their inner command for dangerous-rm / write-path checks (`expandNestedCommands`) | `nestedCommands.test.ts` |
| 10 | `/export file.md` (edits as diffs, results collapsed) and `/export file.json` | `exportMarkdown.test.ts` |

| 11 | `agentDepth` on ToolUseContext; AgentTool kept for subagents while `depth+1 ≤ CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3, settings `maxSubagentDepth`); concurrency cap `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (20, `maxConcurrentSubagents`); `CLAUDE_CODE_SUBAGENT_MODEL` now sits *below* frontmatter/per-call model unless `_FORCE=1` (upstream order); `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS`; `omitClaudeMd` parsed from markdown + JSON agents; subagent output scanning escapes `<system-reminder>`-style tags and flags permission-mode talk | `limitsAndScan.test.ts` |
| 12 | Nested `$(…$(…)…)`/backtick-in-`$()` → `deny` in auto mode, `ask` otherwise (`hasNestedCommandSubstitution`); Vim NORMAL `/` opens transcript search, `Ctrl+R` redo (`useInputBuffer.redo`); Esc aborts a running SessionStart hook at startup (`abortSessionStartHooks`) | `compoundCommandSecurity.test.ts`, `searchRedo.test.ts` |

| 13 | Prompt: feedback bullet → `/feedback` + issues link (Anthropic Slack ID removed); new `# Corrections` / act-when-ready / exploratory-questions / `# Delivering work` static section; frontend-verification bullet when a browser tool is loaded; `# Focus mode` notice (uncached, post-boundary) driven by `/focus`; built-in `Concise` output style; harness lines (parallel tool calls, hook output = feedback) + communication lines (1–2 sentence end-of-turn, no planning docs) | `outputStylesConcise.test.ts`, `focusView.test.ts` |
| 14 | Spinner: `deep in thought` after 45 s of thinking; `Picking the thought back up` via `CompactProgressEvent{type:'output_limit_resume'}` from the query loop | — (render-only) |

| 15 | `SKILL_LEARNING` compiled in (opt-in at runtime); `/undo` reverts last turn's edits; `modelPricing` setting + $0 for unknown non-Anthropic models; `planModel` (architect/editor split for any provider); `repoMap` CodeGraph prompt section; built-in `librarian` agent; `postEditChecks` → synthesized PostToolUse hook | `phase15.test.ts` |

Behaviour change to note: subagents may now spawn subagents (3 layers, like upstream). Set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` or `maxSubagentDepth: 1` to restore the old no-nesting behaviour. Background agents still never get AgentTool (async allow-list unchanged).

Known pre-existing failure on Windows: `udsMessaging.test.ts › drainInbox returns each pending socket message once` (fails on clean tree too).

Follow-ups: `/design*`, `claude plugin eval`, `SubagentHandback`, `WaitForMcpServers`, `experimental.cacheTtl`, cloud-only items remain out of scope.
