# ChatGPT subscription integration

## Build and npm publication

User explicitly requested publication and supplied a local npm-key file. Target is the existing `claude-code-zanii` package on `https://registry.npmjs.org/`; prepare the next minor version, 2.13.0, for the added subscription feature. Registry version availability and publisher access could not be verified: npm is offline, and automatic approval rejected authenticated registry access. No token was read or printed by that rejected command. Do not bypass this restriction.

- [x] Inspect package manifest, build/macros, publish workflow, installed tooling and current checks; Git history remains unavailable.
- [x] Plan build, focused checks, package-content verification and the configured npm upload; publication already authorized by the user.
- [x] Bump package version, rebuild and pack the exact release artifact; confirm entrypoints, metadata and credential exclusion.
- [x] Evaluate local publication handoff. A helper's synthetic test was blocked by Windows ExecutionPolicy; the unverified helper/test were removed. Do not change policy or try an alternate credential-access method; provide standard npm login/publish commands instead.
- [x] Verify package smoke, regression/typecheck/lint status and record artifact hashes/publication status.
- [ ] Publish and verify the remote package. Blocked in this session by automatic approval and network restrictions; do not mark complete without registry confirmation.

Release preparation review: `artifacts/claude-code-zanii-2.13.0.tgz`, 25,591,712 bytes, 1,327 files. SHA-256 `636a2e1881dfb327588f8ba2a12dca8fdef2571257cb1b5234c42b642b01fbbb`; full npm integrity and content checks are in `tasks/verification/publish-artifact-check.json`. Build, 249 focused tests, strict typecheck, lint, lock validation and packed entrypoint/help smoke passed. This is a package-layout smoke using the workspace's dependency installation, not a clean online installation or live account test. A limited token-pattern check found no matches; it does not replace the outstanding dedicated secrets/security scans.

Publication preparation fixed one real bundle dependency defect: declare the already-locked `node-fetch@3.3.2` as a production dependency and align the stale lock root name. The bundle scanner now has one remaining optional keyring import error plus two Bun FFI warnings; reviewed keyring failures fall back to the encrypted file vault. The checker was not marked passing or suppressed. Included usage/readiness docs and updated the README release note. Generated artifacts/npm cache are ignored by Git. No package was uploaded, no Git commit/push was made, and the supplied real npm key was not read or displayed.

## Direct account sign-in follow-up

The existing UI, OAuth service and provider settings are the reference patterns. The stack remains Bun, Commander, TypeScript and the existing protected credential store; no dependency is added. Git history remains unavailable in this extracted checkout.

- [x] Review `src/main.tsx`, `src/cli/handlers/auth.ts`, `src/components/ConsoleOAuthFlow.tsx`, provider settings and browser helper.
- [x] Plan the direct `auth login --chatgpt` command, existing-policy enforcement, cancellation and account-neutral consent; user authorized planning and building.
- [x] Add `src/cli/handlers/chatgptLogin.ts` and its tests; wire `src/main.tsx` and `src/cli/handlers/auth.ts`.
- [x] Fix reviewed activation precedence in both login paths with `chatgptActivation.ts`; respect host-managed routing and confirm the effective saved mode.
- [x] Give the direct login flow signal ownership so existing startup/shutdown handlers cannot preempt cancellation cleanup; test dispatch behavior.
- [x] Include CLI regressions in `package.json`; document the command and account eligibility in the feature guide and change inventory.
- [x] Self-review, focused regression suite, typecheck, lint and rebuild; update verification and readiness evidence.
- [ ] Complete browser consent and live inference on the account owner's machine. No credentials should be sent in chat.

This follow-up adds one CLI entry to the existing local OAuth flow. Policy and conflicting-provider flags must be checked before opening the browser. Only a validated grant with plan-use permission and successful catalog discovery may select subscription mode. Ctrl+C must close the loopback listener and leave provider settings unchanged. No plan-name check, automatic inference, API billing fallback or policy bypass is added. Files: the new handler/test, the two command wiring files, package test script, feature/change/verification/readiness docs and task records. Verification covers success, permission denial, flags, managed policy, cancellation and failed catalog/settings persistence.

Review expanded the necessary file list: shared `src/services/api/openai/chatgptActivation.ts`, its two callers (the new CLI handler and `ConsoleOAuthFlow.tsx`), a light `src/utils/chatgptLoginSignals.ts` ownership module, `src/utils/gracefulShutdown.ts` and signal dispatch regressions. Higher-priority settings and host-managed routing must not be bypassed. Existing global signal handlers must yield only while direct login owns cancellation.

Follow-up review: `bun run test:chatgpt` passes **249 tests, 931 assertions across 16 files**; full strict typecheck, repository lint and primary build pass. Built `auth login --help` exposes `--chatgpt`. The 41 added regressions cover CLI consent, policy, effective selection, host routing and signal dispatch. No live account was connected. The earlier full-suite failures and nine readiness gaps remain open; they were not relabeled as passing or rerun without a relevant fix.

Status: the approved local, single-account integration is implemented and built. Focused regression checks pass; live-account acceptance and the documented release gaps remain open.

- [x] Inspect existing login, auth, provider routing, Responses adapter, tool permissions, models, usage, persistence and tests.
- [x] Research current official Sign in with ChatGPT and compare native integration with Codex app-server/SDK/ACP options.
- [x] Record findings and the proposed file inventory in `reports/ChatGPT subscription integration plan.md`.
- [x] Choose migration of the existing native OpenAI auth-mode route; defer a second agent runtime and Codex session imports.
- [x] Obtain implementation approval for the reviewed plan.
- [x] Prove app-owned signed-identity sign-in, model discovery and a completed text/tool/final-answer conversation against deterministic external-service fixtures.
- [ ] Verify real account/workspace/region eligibility and completed live subscription inference after user browser consent.
- [x] Prove namespaced function mapping and opaque reasoning retention through tool rounds, real normalization/microcompaction and transcript reload; bind state to account/provider/model and reject partial response replay.
- [x] Implement app-owned OAuth registration, signed identity and granted-scope validation, protected atomic credentials, serialized refresh, cancellation and reliable logout.
- [x] Verify eight independent CLI processes refresh the same synthetic account once and retain registration while logout clears tokens.
- [x] Migrate both main and auxiliary inference; validate terminal states, preserve native items, sanitize structured errors and prevent silent paid fallback.
- [x] Update login/status/model discovery and subscription usage labels; retain API-key behavior and prevent legacy 1M suffixes overriding native limits.
- [x] Add focused auth, stream, permission, persistence, context and billing regressions using shared mocks and temporary fixtures.
- [x] Repair installation layout and duplicate React identities; remove dangling absent optional feature registrations and restore missing safety/search/export helpers required for building the existing CLI.
- [x] Run focused tests, typecheck, lint and Bun build successfully; exercise broad tests and the Vite alternative and record environment/source blockers separately.
- [ ] Complete Windows manual sign-in, tool approval/denial, cancellation, concurrent refresh, restart/resume, provider switching and logout acceptance.
- [x] Write operating instructions, architecture/threat model and verification records.
- [ ] Clear or explicitly accept every outstanding readiness GAP before shipping; no release or remote push performed.

## Review

The native provider now uses app-owned Sign in with ChatGPT and the fixed public Responses endpoint. It preserves the existing permission-aware tool loop and stores opaque state once per assistant response. Real normalization, JSON reload and microcompaction tests verify replay; partial edited responses fail closed. One app-owned account/workspace registration is supported. Codex session imports and multi-account management remain outside this milestone.

`bun run test:chatgpt`: **208 pass, 0 fail, 602 assertions** across 14 files. `bun run typecheck`, `bun run lint` and `bun run build` exit 0. Rebuilt Bun and Node entrypoints report 2.12.0; built help loads. Local parser sweep completes 10,210 synthetic streams with zero errors: p99 107.96 ms at 128 concurrent streams, first measured 250 ms budget breach at 256. Independent-process refresh proof observes one refresh across eight overlapping workers.

The complete isolated repository suite exits 1: **6,062 pass, 60 fail, 5 errors** across 459 files. Failures include blocked subprocess wrappers, Windows named-pipe refusal/probe behavior, a temporary-directory fixture, git-context checks, timeouts and search-adapter tests. They are not all proven pre-existing because no pristine full-suite baseline or Git history exists. The focused subscription checks pass separately. Vite encounters managed-environment subprocess restrictions. Built auth-status smoke is blocked before its handler by the existing Windows MDM registry subprocess requirement. Synthetic PowerShell DPAPI round-trip passes, but actual Bun-to-DPAPI execution and real account sign-in/inference/revocation remain unverified. No personal credentials were inspected or membership usage consumed.

See `docs/features/chatgpt-subscription.md`, `docs/chatgpt-subscription-design.md`, `docs/chatgpt-subscription-verification.md`, `docs/readiness-report.md` and `tasks/verification/` for current evidence and the release decision. Git history is unavailable because `.git` is absent. No commit, push or deployment was performed.
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

## Phase 16 — Smarter loop (research §8)

- [x] **16.1** Compile in `REACTIVE_COMPACT`, `UNATTENDED_RETRY`, `POWERSHELL_AUTO_MODE`, `QUICK_SEARCH`, `SKILL_IMPROVEMENT`.
- [x] **16.2** Context window auto-detected from the OpenAI-compatible `/v1/models` (`max_model_len` | `meta.n_ctx` | `context_length` | `context_window`); `model_gateway` passes those fields through.
- [x] **16.3** Repeated-failure loop breaker (3 identical failing tool calls → system reminder).

## Phase 17 — Self-improvement loop + run/verify (v2.14)

- [x] **17.1** `/harness-improve`: `harnessMining.ts` (deterministic counts over the project's last 20 transcripts) + bounded proposal skill with evidence, prediction, ledger (`.claude/harness-ledger.md`).
- [x] **17.2** `RUN_SKILL_GENERATOR`: `/run` + `/run-skill-generator` written; flag back in `DEFAULT_BUILD_FEATURES`; `initBundledSkills` wrapped so a missing skill can't hang boot.
- [x] **17.3** `/verify` available to all users; real SKILL.md + examples replace the 8-byte stubs.

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

| 16 | Smarter loop: `REACTIVE_COMPACT`, `UNATTENDED_RETRY`, `POWERSHELL_AUTO_MODE`, `QUICK_SEARCH`, `SKILL_IMPROVEMENT` compiled in; context window read from OpenAI-compatible `/v1/models` (`max_model_len` / `meta.n_ctx` / `context_length`) + gateway passthrough; repeated-failure loop breaker (3 identical failing tool calls → system reminder) | `repeatedFailure.test.ts`, `contextLengthFromModelEntry.test.ts` |

Behaviour change to note: subagents may now spawn subagents (3 layers, like upstream). Set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` or `maxSubagentDepth: 1` to restore the old no-nesting behaviour. Background agents still never get AgentTool (async allow-list unchanged).

Known pre-existing failure on Windows: `udsMessaging.test.ts › drainInbox returns each pending socket message once` (fails on clean tree too).

Follow-ups: `/design*`, `claude plugin eval`, `SubagentHandback`, `WaitForMcpServers`, `experimental.cacheTtl`, cloud-only items remain out of scope.
