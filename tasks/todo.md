# ChatGPT subscription integration

## CCZ 2.14.9 npm release (2026-10-30)

Authorization: user requested a new release and supplied `secrets/npm_key.txt`.
Publish the reviewed tarball to npm; no Git push is authorized.

Investigation: reference paths are `src/cli/handlers/chatgptLogin.ts`,
`src/cli/handlers/kimiLogin.ts`, and `src/components/ConsoleOAuthFlow.tsx`.
Stack: Bun, strict TypeScript, Commander, Zod, Biome. Existing Kimi region changes
were present before this task; finish their CLI wiring without changing the
historical `cn` default or stored-credential compatibility. Version is sourced
from package.json by scripts/defines.ts. npm latest was verified as 2.14.8.

- [x] Investigate existing edits, callers, release workflow and latest npm version.
- [x] Bump package.json; wire --kimi-region in main.tsx/auth.ts; document the option.
- [x] Extend kimiAuth.test.ts for region routing, refresh, invalid input and compatibility.
- [ ] Self-review; run focused tests, typecheck, lint, full tests and dependency audit.
- [ ] Update docs/readiness-report.md with scoped evidence and explicit limitations.
- [ ] Build, pack, inspect secret exclusion, and smoke-test the exact tarball.
- [x] Install the verified 2.14.9 tarball globally on this PC; both installed launchers report 2.14.9.
- [ ] Publish 2.14.9 with the supplied credential and verify remote version/integrity.

Review: pending. Verification artifacts go in tasks/verification/release-2.14.9/.

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

## 2026-11-25: 2.14.9: Claude 5 models, sign-in fixes, provider and UI fixes

State: released as 2.14.9 together with the Kimi region work. See git log and npm for the commit and publish.

- **Models:** added Fable 5 / 5.1 / 5.2, Opus 4.8 / 5 / 5.5, Sonnet 5 / 5.5, Haiku 5.5 (`configs.ts`). First-party defaults: `opus` = Opus 5.5, `sonnet` = Sonnet 5.5, `haiku` = Haiku 5.5, new `fable` alias = Fable 5.2. Bedrock/Vertex/Foundry defaults unchanged. Capability rules live in `src/utils/model/claudeGeneration.ts` (adaptive thinking, 1M default window, no sampling params, no disabled thinking, forced `tool_choice` downgraded to `auto` plus a system instruction). `/model` on first-party is one list without `[1m]` rows. Pricing added in `modelCost.ts`.
- **Sign-in:** `installOAuthTokens` now resets `modelType` and `OPENAI_AUTH_MODE`, so `ccz auth login` after a ChatGPT/Kimi login really switches back. A stray `OPENAI_BASE_URL` / `GEMINI_BASE_URL` no longer disables a Claude subscription login. Failure to remove ChatGPT/Kimi credentials no longer fails an Anthropic login.
- **UI:** ChatGPT model list is saved to the global config and no longer wiped before a refresh (fixes "200K context" for `gpt-6.1-sol`, live check: 500000). Header says "Claude Code Zanii" in the condensed layout; billing label and `/status` name the ChatGPT / Kimi plan; no blank base-URL rows; Gemini errors show the API message, not raw JSON.
- **Provider fixes (second pass):** Kimi sessions name `kimi-for-coding` in the UI and usage records, hide the effort control, route side queries (auto-mode classifier) through the Kimi token and host, and `/login` has a China row and an International row. `/model` on OpenAI-compatible, Gemini and Grok shows only the default, env-mapped tiers and the server's own list, with no 1M toggle. `/usage`, `/cost` and `/stats` show this session's totals when there is no Claude plan. Claude plan limits no longer stay frozen in the status line after a provider switch. Fast mode covers Opus 5.5 ($8 / $40). An Anthropic login also removes `CLAUDE_CODE_USE_OPENAI/GEMINI/GROK` from user settings, and `ccz auth login` prints a note when one was set in the environment.
- **Tests:** precheck 6157 pass, 0 fail. `test:chatgpt` 266 pass, 0 fail. `kimiAuth` tests moved to the isolated run (`kimiAuth.isolated.ts`): `autonomyPersistence.test.ts` replaces the file lock with a no-op for the whole shared process, which broke the concurrent-refresh test there. Build OK; built CLI ran a tool call on `gpt-6.1-sol` and reported a 500000 window.
- **Not verified live:** no request was sent to Anthropic with the new models (this PC is signed in to ChatGPT), and no Kimi, Gemini or Grok account was available. The Bedrock IDs for the new models (`us.anthropic.<id>`) are a guess. Kimi's context window is still the 200K default; its real window is not known here.
- **Opt-in, off by default:** server-side refusal fallback (`CLAUDE_CODE_REFUSAL_FALLBACK=1`) for Fable / Opus 5.x / Sonnet 5.5. Turn it on by default once it has been run against the live API.
- **Left as is:** the 5h / 7d bars cannot be filled for other providers. ChatGPT responses carry no usage-limit headers, and OpenAI-compatible endpoints report per-minute buckets, not plan windows. The built-in status line hides the segments when there is no data.

## 2026-11-26: 2.14.10: Fable 5.2 fit (request handling, prompts, task tracking)

Source: two read-only audits against Anthropic's Fable 5.2 migration guide.

- **Requests on Claude 5 (first-party):** send `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` with beta `thinking-binding-controls-2026-08-01`, so a history edit drops the model's reasoning instead of failing the request (off switch: `CLAUDE_CODE_DISABLE_THINKING_BINDING=1`). Deferred-tool announcements are re-inserted where they were first sent. No manual thinking budget on Opus 4.7+ (main loop and token counting). Reasoning summaries requested (`display: "summarized"`); interleaved-thinking and redact-thinking headers not sent on Claude 5. Tool-result clearing starts at 80% of the window instead of 180K. A broken stream is retried as a stream, not rerun non-streaming. Fable / Mythos default to `high` effort. Fast mode enabled for Fable 5.2 ($16 / $80).
- **Refusals:** a refused response cancels its tool calls and ends the turn; partial output is dropped when nothing ran. The message suggests a current model.
- **System prompt on Claude 5:** `focus_mode` and `repo_map` sections are fixed per conversation; `/focus` is announced by an appended reminder.
- **Prompts:** final recap sized to the work (no two-sentence cap); `# Finishing work` section; exploratory-question rule no longer conflicts with auto mode; questions batched; June 2026 cutoff for Fable / Mythos 5.1 and 5.2; fork workers no longer commit and have no 500-word cap; Agent tool description matches the code (fork = omit `subagent_type`, cost stated, background behaviour).
- **Task tracking:** task tools are offered on Claude 5 again (upstream drops them).
- **Auto-mode classifier:** 8K headroom on models that cannot turn thinking off.
- **Tests:** precheck 6160 pass, 0 fail. `test:chatgpt` 266 pass, 0 fail. Built CLI ran one-tool and two-tool prompts on `gpt-6.1-sol`.
- **NOT verified live:** nothing here was run against Anthropic; this PC was signed in to ChatGPT at release time. First thing to check on a Fable session: a second turn after a tool call succeeds, and reasoning summaries show. If a Claude 5 request fails with a 400 naming `block_binding` or the beta header, set `CLAUDE_CODE_DISABLE_THINKING_BINDING=1` and fix forward.
- **No unit test:** the refused-turn branch in `src/query.ts` (needs a query-loop harness).
- **Still open:** `/break-cache`, `/advisor` and worktree switches still change the system prompt mid-conversation (covered by drop_block, at the cost of some reasoning). Verification is still prompt-only. The compaction and verifier prompts keep their old style. The opt-in refusal fallback does not filter blocks before the last `fallback` block.

## 2026-11-26: after 2.14.10 (committed locally, NOT pushed, NOT released)

- **Compaction prompt on Claude 5:** no written `<analysis>` block. The checklist stays but is done in the model's own reasoning. Reason: the block was output paid for and then stripped, and a required reasoning section can be declined by the reasoning-extraction safeguard, which would fail a compaction. Older models keep the old prompt.
- **Worktree enter/exit on Claude 5:** the system prompt sections are no longer cleared mid-conversation; the tool result already names the new directory. They recompute at the next /clear or compaction.
- **Decided not to change:** `/break-cache` and `/advisor` (changing the prompt or tool list is their purpose); the verifier prompt style (taste, no evidence of harm).
- **Verification:** the structural nudge in `TaskUpdate` (3+ tasks closed, no verifier run) is active on Claude 5 again since 2.14.10 re-enabled the task tools. No second mechanism added.
- **Tests:** precheck 6162 pass, 0 fail. `test:chatgpt` 266 pass, 0 fail.
- **Next release:** 2.14.11, after the live Fable test (needs `ccz auth login --claudeai` on this PC).

## 2026-11-26: 2.14.11: live-tested on Anthropic (Claude Max sign-in)

Live results, run from source and from the built CLI:
- **Fable 5.2:** single prompt OK (1M window); multi-step task with Read and Grep OK (4 turns, prompt cache reused, no rejected request); reasoning summaries arrive non-empty; auto-mode classifier ran and allowed a shell command; a general-purpose subagent returned a correct result; `/compact` worked with the new prompt and the session continued correctly after it.
- **Opus 5.5, Sonnet 5.5, Haiku 5.5:** tool task OK on each, 1M window reported.
- **Thinking binding:** the beta header and `drop_block` are accepted. `input_transformations` was empty in every run above, so a normal tool loop, a subagent and a compaction drop no reasoning. Drops are now logged at debug level as `[thinking-binding]`.
- **Not exercised live:** fast mode, `/focus` mid-conversation, worktree switch, a refused response, forks (interactive only), the opt-in refusal fallback, Bedrock/Vertex/Foundry.

Changes since 2.14.10: compaction prompt without written analysis on Claude 5; system prompt kept on worktree switch; debug log for dropped reasoning; `getAllBaseTools` no longer resolves the model (the task-tool gate does not use it), which also stops the tool-chain integration tests failing on a machine signed in to Anthropic without an API key.

Tests: precheck 6162 pass, 0 fail. `test:chatgpt` 266 pass, 0 fail.

## 2026-11-26: 2.14.12: `ccz work <config>`

- New command: takes work orders from a Zanii Calls server and runs each in a separate git worktree by starting this same CLI as a separate headless process. Source of truth is `connector/ccz/work.ts` in the live_kit project; `src/cli/handlers/work.ts` is a copy (reformatted by this repo's formatter, logic unchanged). Its Python twin is `connector/zanii_worker.py`: change both together.
- Wiring: `src/main.tsx`, registered before `mcp`, with an explicit `process.exit` after `workHandler` returns (startup leaves handles open; without it a config error printed and then hung).
- Verified: 12 connector tests pass; built node and bun CLIs print help and exit 0, and exit 1 with a plain error on a missing config; `process.argv[1]` is the CLI entry file in both builds; one real order ran end to end on the node build against a local stand-in server (worktree branch `zanii/work-1`, main untouched, hand-in received).
- Not tested inside the built CLI: cancel/stop and the time limit.
- Test fix: `zaniiAgent.test.ts` replaced global `fetch` and left `ZANII_PROOF=1` set for the rest of the test process. It now flushes, switches the feature off and restores `fetch` when it finishes. Before, its stub answered other files' requests, and without the stub its queued submit reached the real network.
- Tests: precheck 6174 pass, 0 fail. `test:chatgpt` 266 pass, 0 fail.

## 2026-11-26: 2.14.13: slash command audit fixes

Source: a read-only audit of every command in the `/` menu (about 131: 104 work, 20 need a Claude sign-in, 5 partial, 2 broken).

- `/agents`: removed the `agents` alias from `agents-platform`, which shadowed the local agent manager on Claude sign-ins.
- `/daemon start`: launched as a detached process (it used to run the supervisor inside the REPL and never return).
- `/tui`: `isFullscreenEnvEnabled` now reads the `.tui-mode` marker the command writes.
- `/ultrareview`, `/ultraplan`, `/teleport`, `/autofix-pr`: `availability: ['claude-ai']`. `/chrome` left visible on purpose (the fork sets `availability: []`; the Chrome bridge package works without a subscription). `/voice` left visible (works with a Doubao key).
- `/assistant`: no "panel" wording; a second run says the mode is already active.
- `/feedback`, `/bug`: disabled (`isEnabled: () => false`) until there is a Zanii feedback endpoint. Code kept.
- `/release-notes`: reads `CHANGELOG.md` from `vigilancetrent/claude-code-zanii`. New `CHANGELOG.md` covers 2.14.4 to 2.14.13; a test requires an entry for the current version, so add one on every release.
- Artifacts: opt-in. No built-in server or token; tool, `/artifacts` and `/use-artifacts` need `CLAUDE_ARTIFACTS_URL`.
- Web search: the tool message names the community server when it is the default in use.
- Tests: precheck 6177 pass, 0 fail. `test:chatgpt` 266 pass, 0 fail. Built CLI: agent task and web search OK.
- **Not checked in the real UI:** none of the changed commands was run interactively. To do by hand on a Claude sign-in: `/agents`, `/daemon start` then `/daemon status`, `/tui on` then restart, `/release-notes`, and confirm `/feedback` is gone.
- **Still open from the audit:** web fetch also uses the community Tavily host (no notice added); `/usage` no longer reaches the old activity stats; `/mobile` and `/stickers` point at Anthropic's app and shop; `/perf-issue` cost table has Claude models only; whether Anthropic's cloud accepts this fork for ultrareview, ultraplan, teleport, autofix-pr and triggers is untested.

## 2026-11-26: 2.14.14: worker auto start

- User settings `workAutoStart: "<path to worker.json>"`: opening an interactive `ccz` starts `ccz work <config>` detached, if no worker is running. Read from USER settings only (the worker config decides the command and permissions, so project settings must not be able to redirect it). Hook: `renderAndRun` in `src/interactiveHelpers.tsx`; logic in `src/utils/workAutoStart.ts`. `work.ts` is untouched.
- One worker per PC: pid file `work.pid` in the config folder, claimed with an exclusive create; output goes to `work.log` there.
- New plain commands: `ccz work-status`, `ccz work-stop`.
- The key must be available to a background process: `key_file` in the worker config, or `ZANII_CALLS_AGENT_KEY` set for the user account (not only in one terminal).
- Verified: 6 isolated tests; real run with the built CLI as the worker against a stand-in server (started once, second start reported running, survived the starter exiting, logged, `work-stop` ended it and removed the pid file).
- Not verified: the three-line call site in the interactive UI (cannot be driven from a script).
- Limits: on Linux/macOS `work-stop` signals the worker's process group; an agent the worker started runs in its own group and may finish its current order. A pid reused by another program blocks a new worker until `work-stop`.
- Tests: precheck 6177 pass, 0 fail. `test:chatgpt` 272 pass, 0 fail.

## 2026-11-26: 2.14.15: worker questions, approvals, --install

- `src/cli/handlers/work.ts` and its test updated from the connector source (logic unchanged; reformatted by this repo's formatter on commit). `src/main.tsx`: `--install` and `--uninstall` passed to `workHandler`.
- Verified with the built CLI: 19 connector tests; `--install` without `key_file` prints the reason, exits 1, writes nothing; `--install` with a valid config was NOT run (it changes this PC's startup; the owner does that).
- Real orders against a stand-in server:
  - Approval: a shell command outside the allowed tools arrives as `kind: approval` with the exact command; refused, the agent stops and changes nothing. Works.
  - `ask_owner`: does NOT arrive as a question by default. MCP tools need permission in acceptEdits mode, so the call goes to the approve tool first, and through `ExecuteExtraTool` (deferred tools) the request names the wrapper. Works without a double prompt only with `ENABLE_SEARCH_EXTRA_TOOLS=0` in the worker's environment plus `--allowedTools mcp__zanii__ask_owner`.
- **Open, ccz side:** `ExecuteExtraTool.checkPermissions` returns `passthrough`, so allow rules for the target tool do not apply and the prompt shows the wrapper's name (`packages/builtin-tools/src/tools/ExecuteTool/ExecuteTool.ts:220`). Fixing it there would make `--allowedTools mcp__zanii__ask_owner` enough.
- **Open:** after a refused shell command that wrote a file, the agent wrote the same file with the file editor (allowed in this mode).
- **Two auto-start paths:** `workAutoStart` (2.14.14, starts when ccz opens, pid-file guard) and `--install` (Startup file, restarts every minute). Together they run two workers on one key. Decide which to keep.
- Tests: precheck 6184 pass, 0 fail. `test:chatgpt` 272 pass, 0 fail.

## 2026-11-26: 2.14.16 (part 1): wrapper permissions, one auto-start path

- **ExecuteExtraTool permissions:** `checkPermissions` now decides as the target tool: deny rule, ask rule, the target's own check, then allow rule. Before, it always returned `passthrough`, so allow rules for a deferred tool never matched and every deferred call asked. The request still carries the tool name `ExecuteExtraTool` with the target and params in its input; the name itself is not rewritten.
- **Live check** (built CLI, stand-in server, config with only `"extra_args": ["--allowedTools", "mcp__zanii__ask_owner"]`, no `ENABLE_SEARCH_EXTRA_TOOLS`): the ask arrives as `kind: question` first, the answer reaches the agent, the file is written. A shell command outside the allowed tools still arrives as `kind: approval` and a refusal is respected.
- **One auto-start path:** `ccz work` no longer offers `--install` / `--uninstall` (removed from `src/main.tsx` only; `work.ts` keeps the code and stays identical to the connector source). `workAutoStart` is the supported way. Tell the connector author: its README still documents `--install` for ccz.
- Behaviour change to note: a deferred tool whose own permission check returns `allow` now runs through ExecuteExtraTool without a prompt, the same as when it is called directly.
- Tests: precheck 6184 pass, 0 fail. `test:chatgpt` 280 pass, 0 fail (8 new for the wrapper's permissions).

## 2026-11-26: 2.14.16 (part 2): connector update, live checks

- `work.ts` and its test updated from the connector source (22 tests): the worker adds `mcp__zanii__ask_owner` to the agent's allowed list itself (`withAskTools`), and the approval handler looks inside `ExecuteExtraTool {tool_name, params}`. Wiring unchanged (no `--install`, explicit exit).
- Live, built CLI, stand-in server, NO `extra_args`:
  - Question: arrives first as `kind: question`; answer reaches the agent; file written.
  - Approval: shell command outside the allowed tools arrives as `kind: approval` with the exact command; refused; nothing changed.
  - Push, first run: the agent did not attempt it; it asked the owner a question about the conflict with its job rules and stopped. Nothing pushed.
  - Push, owner answers yes: the agent ran `git push origin HEAD:refs/heads/pushed-by-agent`; refused on this PC with "This worker never pushes"; the server received no approval ask for it; the local bare remote still had only `main`.
- Not exercised live: a push sent through `ExecuteExtraTool` (Bash is a core tool, so the agent calls it directly). The connector's own tests cover that path.
- Before turning on `workAutoStart`: an old worker (2.14.13 code, same key) may still be running on this PC. End it in Task Manager: a node process whose command line has `work` and `worker.json`.
- Tests: precheck 6187 pass, 0 fail. `test:chatgpt` 280 pass, 0 fail.
