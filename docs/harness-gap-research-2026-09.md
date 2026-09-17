# CCZ Harness Gap Research — September 2026

**Date:** 2026-09-17
**Scope:** What official Claude Code (v2.1.274, 2026-09-17) and competing harnesses (Codex CLI, OpenCode, Gemini CLI, Cursor CLI, Copilot CLI, Amp, Droid, Kiro, …) have that CCZ (`claude-code-zanii` v2.11.0) does not.
**Method:** Grepped CCZ `src/`, `packages/builtin-tools/`, `scripts/defines.ts` for commands, tools, feature flags, model tables, hook events; compared against upstream changelog + docs and third-party changelogs. Sources at the end.

---

## 0. Where CCZ sits

| | CCZ v2.11.0 | Claude Code v2.1.274 |
|---|---|---|
| Upstream base | decompiled ≈ v2.1.12x (memory-leak audit references 2.1.101–2.1.121) | — |
| Release gap | ~150 upstream releases behind | — |
| Newest model IDs in `src/utils/model/` | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` | Opus 5 (default, 1M ctx), Sonnet 5, Fable 5.1, Haiku 4.5 |
| `@anthropic-ai/sdk` | ^0.81.0 | current |
| Slash commands | ~150 dirs in `src/commands/` (incl. many CCZ-only) | ~80 documented |
| Built-in tools | 60 in `packages/builtin-tools/` | ~45 core + deferred |
| Hook events | 27 (`src/entrypoints/sdk/coreSchemas.ts`) | 27 |

CCZ is **feature-rich but ~4 months stale**. Most of what's missing is either (a) new since April 2026 upstream, (b) tied to Anthropic cloud services (claude.ai, routines, Slack, cloud sessions), or (c) things other harnesses do better for local/open-model users — which is CCZ's actual audience.

---

## 1. Missing vs. Claude Code — prioritized

### P0 — Blocks day-to-day use

| Gap | Upstream | CCZ state | Notes |
|---|---|---|---|
| **Claude 5 model family** | Opus 5 default (1M ctx), Sonnet 5, Fable 5.1 (`$10/$50`), 1M context on Fable | Model table stops at Opus 4.7 / Sonnet 4.6. No `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1` in `models.ts`/`aliases.ts`/`modelCapabilities.ts` | Passthrough may work for firstParty, but aliases (`opus`, `sonnet`, `opusplan[1m]`), capability gates (effort, 1M, adaptive thinking), pricing in `/cost`, and the `/model` picker are wrong. Also: stale-thinking-block tolerance for Claude 5 (OpenCode fixed this 2026-09-01) |
| **Auto mode as default** (classifier-driven permissions) | Default on Pro/Max/Team since 2026-08-14; refuses transcript tampering; per-command `allowed_domains`; Containment Escape rule; one-time prompt for reads outside cwd | `yoloClassifier.ts` routes via `sideQuery()` which already handles OpenAI/Grok/Gemini; but `BASH_CLASSIFIER` and `TREE_SITTER_BASH` are **not** in `DEFAULT_BUILD_FEATURES`, auto mode is opt-in, and the `tengu_auto_mode_config` GrowthBook gate is a stub | Make auto the default mode when a classifier model is reachable; enable the bash rule set; add per-command `allowed_domains` |
| **Fork mode default** (`/fork`, background subagent inherits full conversation, `@session-name` reattach) | On by default since 2026-08-21 | `FORK_SUBAGENT` listed as **disabled** in `CLAUDE.md`; `src/commands/fork/` exists | Enable + verify against OpenAI/Gemini providers (prompt-cache retention on fork) |
| **Prompt-cache stability** | Byte-stable tool lists; deferred tools for disconnected MCP; no re-send on `/model` switch; `/cost` shows cache-miss cause; fork keeps cache | `PROMPT_CACHE_BREAK_DETECTION` exists; unknown whether the 2.1.26x tool-list-stability fixes landed | Audit `src/tools.ts` + `claude.ts` against upstream 2.1.267 "Tool Management" items |

### P1 — Commands / tools upstream has, CCZ lacks

| Missing | What it does (upstream) | Nearest CCZ thing |
|---|---|---|
| `/design`, `/design-sync`, `/design-login` | Draft UI mockups as editable artboards on Artifacts (research preview) | Artifact tool only |
| `/deep-research <q>` | Dynamic workflow: fan-out web searches → synthesized report | `WORKFLOW_SCRIPTS` + `WebSearchTool` — no bundled workflow |
| `/subtask [prompt]` | Hand a side task to a subagent | `AgentTool` manual |
| `/list-agents`, `ListAgents` tool | Enumerate messageable sessions/subagents | `/peers`, `ListPeersTool` (LAN pipes) — different model |
| `/tasks` | List background work + subagents | `TaskListTool` (todo list), `/job` |
| `/import [source] --dry-run` | Import config from Cursor/Codex/Copilot etc. | none |
| `/prompt-audit` | Flag/fix outdated prompts in CLAUDE.md/skills | none |
| `/skill-doctor` | Unused loaded skills + context cost | none |
| `/usage-credits` | Usage-credit balance | `/usage`, `/extra-usage` |
| `/diff` panel | Fullscreen side-by-side uncommitted changes | `src/commands/diff/` exists — check it's the panel, not a dump |
| `/focus` | Prompt + one-line summary + response only | grep hits are noise; no `focus` command dir |
| `/output-style [name]` in headless/RC | Concise style, custom style builder | `output-style` dir exists; Concise style? |
| `/effort` session-only (`s` flag), `maxEffortLevel` setting | Per-session effort; org cap | `effort` cmd exists; `maxEffortLevel` **absent** |
| `/autocompact [auto\|tokens]` | Configurable auto-compact window | `REACTIVE_COMPACT` flag |
| `/heapdump`, `/checkup` | Memory diag; env doctor with auto-fix | `heapdump` exists; `doctor` exists |
| `/passes`, `/mobile`, `/desktop`, `/teleport`, `/autofix-pr`, `/remote-control` | Anthropic-cloud tied | `mobile`, `desktop`, `teleport`, `autofix-pr` dirs exist but depend on claude.ai |
| `claude plugin eval` | Plugin eval suite → JSON/HTML score report | none |
| `claude plugin … --json`, `--accept-command <sha256>` | Scriptable plugin mgmt | none |
| `--plugin-dir <folder-of-plugins>` | Load many plugins from one dir, hot pickup | check |
| `--restricted` / `CLAUDE_CODE_RESTRICTED` | Read-only review mode | `restricted` grep hits — verify a CLI flag |
| `--tools`, `--agents <json>`, `--append-subagent-system-prompt-file`, `--system-prompt-snapshot off` | Headless/SDK ergonomics | partial |
| `omitClaudeMd` agent frontmatter | Subagents skip CLAUDE.md | 4 hits — verify |
| `bashOutputMaxChars` / `taskOutputMaxChars` (up to 128K), 1 GB tool-result cap w/ preview | Output limits | absent |
| `bashEditDiffEnabled` | Bash results include diff of touched files | absent |
| `CLAUDE_CODE_GATEWAY_HINT_HEADERS`, `x-claude-code-*` headers | LLM-gateway routing hints | absent — **relevant for `model_gateway/`** |
| `CLAUDE_CODE_WEBFETCH_DEADLINE_MS` (300 s default) | WebFetch hang guard | check |
| `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`, `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (1–256) | tunables | absent |
| `timeFormat` / `timeZone` settings | 12/24 h, tz for display | absent |
| Monitor deadline (max 30 min, 10 in `-p`), re-arm notification | replaces `persistent` | `MonitorTool` — old semantics |
| Cross-session messaging with delivery notices for headless senders | `SendMessage` queued/delivered status | `SendMessageTool` exists; UDS_INBOX/LAN_PIPES disabled |
| Hook event `Interrupt` (Codex 0.150) | fires on Esc/Ctrl-C mid-turn | CCZ SDK schema already has 27 events incl. `PreCompact`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeRemove` — only `Interrupt` missing |
| Hook progress UI (elapsed time, Esc cancels SessionStart hook) | | absent |
| `/mcp` disconnect notification + reconnect-gave-up notice; per-server auth notice | | check |
| MCP 2026-07-28 protocol, `listChanged` refresh, `insufficient_scope` naming | | `@modelcontextprotocol/sdk ^1.29` — likely older protocol |
| Artifact: markdown → styled page, tab icons, 10 watched, capability contract versions | | `ArtifactTool` — verify version |
| VS Code: Agent map, Hooks dialog, Permission-rules dialog, Focus view, session archiving, MCP servers dialog | IDE extension | `vscode-ide-bridge` aux dir only |
| OTel: `managed_settings_resolved` event, `effort` span attr, `OTEL_METRICS_INCLUDE_REPOSITORY` | | `otel` 59 hits; verify |
| Memory: Memory & Instructions menu, `MEMORY.md` truncation warning w/ line counts, `.claude/rules/` | | CCZ has its own L1/L2/L3 memory; `.claude/rules` 8 hits |
| Task tools gated off on Claude 5 (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` to force) | upstream dropped TodoWrite/TaskCreate for new models | CCZ always loads them — pointless context cost on Claude 5 |
| Bash permission hardening: nested shell expansions, `tee` write-path checks, special-var assignment, `rm -rf` via `sh -c`/positional params, wildcard in patterns | many 2.1.26x–27x fixes | `TREE_SITTER_BASH` flag not in defaults; audit `bashClassifier.ts` |
| Sandboxing: `allowed_domains` per command, network allowlists | | `sandbox` 110 hits; `allowed_domains` 5 hits — verify per-command |

### P2 — Anthropic-cloud-only (not reproducible without claude.ai; document as out-of-scope or replace with self-hosted equivalents)

- Routines (scheduled cloud agents, Yours/Templates, reply-in-thread), Cloud sessions, Self-hosted runners (`claude self-hosted-runner --drain-marker-file`, `--remove-session-state`), `/ultrareview` (multi-agent cloud review), Claude Tag (Slack), Claude apps gateway (`pricing`, `multiplier`, `gatewayInternalNetworks`, `oidc.scope_on_refresh`, drain timeout), `/insights` (cloud Opus), Advisor tool (second-model opinion — **could** be local), Fast mode (`/fast`, Anthropic-only pricing), 1M-context credits, `/web-setup`, GitHub App / GitLab.
- CCZ already has self-hosted substitutes for some: `packages/remote-control-server/` (RC), `packages/cloud-artifacts/` (artifact hosting), `ScheduleCronTool`, `channels` (Slack/Discord/Feishu/WeChat), Langfuse tracing.

---

## 2. Missing vs. other harnesses (things upstream Claude Code also lacks or does worse)

CCZ's differentiator is "Claude Code UX on any model". These are what the open/multi-provider harnesses ship that CCZ should match:

| Capability | Who has it | CCZ status | Why it matters for CCZ |
|---|---|---|---|
| **Provider-agnostic auto-approve classifier** | Codex (`writes` approval mode, Guardian), OpenCode permission rules | Anthropic-endpoint only | See P0 |
| **Model discovery from `/v1/models`** with per-request switch | OpenCode (auto Modal/Cloudflare discovery), Codex | Done for OpenAI-compatible (`feat: auto-list OpenAI-compatible models`) + `model_gateway/` | Extend to Gemini/Grok; cache TTL; show backend health |
| **Reasoning-effort variants per provider** (`gpt-6-astra`, DeepSeek/Qwen thinking modes, Claude 5 effort) | OpenCode (reasoning effort variants for GitLab GPT & Claude), Codex (Ultra reasoning) | DeepSeek thinking in openai adapter; `effort` only gated to Anthropic models | Map `effort` → `reasoning_effort` / `thinking.budget_tokens` per provider |
| **Token budget per rollout / per thread**, abort when exhausted, nested-subagent tokens counted | Codex v0.151–0.154 | `TOKEN_BUDGET` flag, `/goal` budgets | Extend to subagents + workflows |
| **Configurable `subagent_depth`** (no nested subagents by default) | OpenCode v1.18.2 | none | Cheap safety knob for local models that over-delegate |
| **Multi-agent delegation policy**: disabled / explicit-only / proactive, per thread + turn | Codex app-server | none | Same knob as above, exposed in settings |
| **MCP per-tool output token limit**, discovery grace period, extensions that inspect/replace tool results | Codex v0.151–0.152 | none | Local models choke on 100K tool outputs; upstream has `bashOutputMaxChars` only |
| **Vim mode** (search, undo/redo, motions) | Codex v0.152–0.153 | `src/commands/vim/` exists — parity check | |
| **Export session → Markdown/JSON**, complete patch history in TUI, incremental transcript browsing | Codex v0.148/0.153, OpenCode v1.18.15 | `/export` plain text | Add JSON + markdown w/ diffs |
| **Interactive `agents` dashboard**, `codex queue` (message a session), `/cd /pwd` | Codex v0.149 | `claude agents`, `/send`, `/cd`? | verify `/cd` (upstream added it too) |
| **Client-server architecture** (one backend; TUI + web + editor clients), multi-session parallel | OpenCode | RCS web UI + ACP link partially there; no shared-server for local TUI | Consider `acp-link` as the single backend for TUI/web |
| **LSP auto-configuration** (auto-install/spawn language servers) | OpenCode | `LSPTool` + `docs/lsp-integration.md` — manual | auto-detect from project files |
| **Conversation checkpointing / rewind with file restore** | Gemini CLI, Claude Code `/rewind` | `rewind` cmd exists (35 hits) — verify file-snapshot restore works with all providers | |
| **Google Search grounding** | Gemini CLI | `WebSearchTool` Bing/Brave | Add Gemini grounding when provider = gemini |
| **Cloud agents / hand-off to VM that keeps running** | Cursor CLI Cloud Agents, Claude Code cloud sessions | Daemon + BG_SESSIONS local only | Document RCS + daemon as the self-hosted equivalent |
| **Spec-driven dev** (EARS requirements → tasks) | Kiro | `/plan`, `interview` skill | optional |
| **Composable specialist subagents** (Oracle / Librarian / Painter; Code / Knowledge / Reliability Droids) | Amp, Droid | `BUILTIN_EXPLORE_PLAN_AGENTS` | Ship 2–3 more bundled agents (library-docs, incident) |
| **Memory Bank of architectural decisions**, 500+ models / 60+ providers, no-markup pricing | Kilo | L1/L2/L3 memory ✔; 7 providers | Add OpenRouter/LiteLLM/Ollama presets in `/login` |
| **Voice-to-code** | Aider, Claude Code Voice | `VOICE_MODE` ✔ (needs Anthropic OAuth) | Use `doubaoSTT.ts` / local whisper for non-Anthropic |
| **Auto-commit with generated messages** | Aider | `/commit`, `COMMIT_ATTRIBUTION` | fine |
| **Cross-platform** (Android/BSD) | Crush | Win/mac/Linux | fine |
| **Privacy-first: no code leaves machine** | OpenCode | Zanii ledger sends hashes only; Langfuse optional | Document clearly; add `ZANII_PROOF=0` in first-run |
| **Bedrock as built-in provider for GPT models**, Azure Entra ID login, Cloudflare AI Gateway passthrough | Codex v0.148, OpenCode Sept | Bedrock (Claude only) | Add Azure OpenAI Entra auth, CF AI Gateway model-ID conversion |
| **MCP 2026-07-28 protocol** | Codex v0.147 | SDK ^1.29 | bump `@modelcontextprotocol/sdk`, verify `listChanged`, elicitation |

---

## 3. CCZ-only features (no gap — keep, but they're undocumented upstream-equivalents)

Zanii proof-of-action ledger · `/poor` budget mode · Layered L1/L2/L3 memory + `/memory audit|list|clear` · WikiSearchTool + Magic Docs · ImpactAnalysisTool / CodeGraph · Pipe IPC + LAN swarm · Channels (Slack/Discord/Feishu/WeChat) · Langfuse tracing · Self-hosted RCS + web UI · ACP (Zed/Cursor) · Computer Use on 3 OSes · Bing/Brave search · Skill promotion · Team loadouts · Daemon mode · `/teach-me` · legacy conhost mode · OpenAI/Gemini/Grok adapters · `model_gateway/` (llama.cpp + vLLM router).

---

## 4. Recommended order of work

1. **Claude 5 models** — add `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1` to `models.ts`, `aliases.ts`, `modelCapabilities.ts` (effort, 1M, adaptive thinking), pricing table; gate Todo/Task tools off on Claude 5 like upstream; tolerate stale thinking blocks. *(1–2 files each, SIMPLE)*
2. **Auto mode by default** — enable `BASH_CLASSIFIER`/`TREE_SITTER_BASH` in `DEFAULT_BUILD_FEATURES`; default permission mode → `auto` when classifier reachable (any provider via `sideQuery`); add per-command `allowed_domains`. *(STANDARD)*
3. **Fork mode on by default** — flip `FORK_SUBAGENT`, test cache retention on OpenAI/Gemini. *(SIMPLE)*
4. **Output/tool-result limits** — `bashOutputMaxChars`, `taskOutputMaxChars`, MCP per-tool output cap, 1 GB disk cap w/ preview. Local models need this most. *(SIMPLE)*
5. **Effort → provider mapping** — `effort` ⇒ `reasoning_effort` (OpenAI), `thinking_budget` (Gemini), DeepSeek/Qwen thinking toggles. *(STANDARD)*
6. **Gateway hint headers** — emit `x-claude-code-request-class` / `agent-type` / `compaction` when `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`; teach `model_gateway/gateway.py` to route on them (e.g. subagents → small model). *(SIMPLE, pairs with existing untracked work)*
7. Missing commands with no cloud dependency: `/skill-doctor`, `/prompt-audit`, `/subtask`, `/list-agents`, `/tasks`, `/import`, `/deep-research` workflow, `/focus`, `/autocompact`, `claude plugin eval`, `plugin --json`.
8. Hook progress UI (elapsed time, Esc cancels SessionStart) + `Interrupt` event.
9. `subagent_depth` / delegation-policy setting; per-thread token budget incl. subagents.
10. Bump `@modelcontextprotocol/sdk` to 2026-07-28 protocol; MCP disconnect notices.
11. Bash-permission hardening backports (nested expansions, `tee`, `sh -c rm -rf`, wildcard patterns); enable `TREE_SITTER_BASH`.
12. `/export` → markdown/JSON with patch history; Vim-mode parity.

Skipped on purpose: Routines, Slack Tag, cloud sessions, `/ultrareview`, apps gateway, VS Code panels — all require Anthropic infra; RCS/channels/cron already cover the self-hosted story.

---

## Sources

- [Claude Code changelog (official)](https://code.claude.com/docs/en/changelog)
- [Claude Code slash commands reference](https://code.claude.com/docs/en/commands)
- [anthropics/claude-code CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- [Auto mode default announcement](https://claude.com/blog/auto-mode-default-in-claude-code)
- [Claude Code August 2026 roundup — Tech Bytes](https://techbytes.app/posts/claude-code-august-2026-update-roundup/)
- [August 2026 feature summary — AIworker](https://note.com/ai__worker/n/n74cb8328b0cb?hl=en)
- [Claude Code changelog — ClaudeLog](https://claudelog.com/claude-code-changelog/)
- [Claude Code changelog — gradually.ai](https://www.gradually.ai/en/changelogs/claude-code/)
- [Codex CLI changelog — gradually.ai](https://www.gradually.ai/en/changelogs/codex-cli/)
- [Codex updates — Releasebot](https://releasebot.io/updates/openai/codex)
- [OpenCode changelog — gradually.ai](https://www.gradually.ai/en/changelogs/opencode/)
- [OpenCode changelog (official)](https://opencode.ai/changelog)
- [2026 Guide to Coding CLI Tools: 15 agents compared — Tembo](https://www.tembo.io/blog/coding-cli-tools-comparison)
- [CLI coding agents comparison — hidekazu-konishi](https://hidekazu-konishi.com/entry/cli_coding_agents_comparison.html)
- [OpenCode vs Claude Code vs Copilot vs Gemini — DEV](https://dev.to/mendesbarreto/opencode-vs-claude-code-vs-copilot-vs-gemini-very-simple-review-1dpm)
- [Best CLI AI coding agents 2026 — DevToolLab](https://devtoollab.com/blog/top-cli-ai-coding-agents)

---

## 5. Tools & subagents — focused pass (added 2026-09-17, second round)

Source: [Claude Code sub-agents reference](https://code.claude.com/docs/en/sub-agents) vs `packages/builtin-tools/src/tools/AgentTool/`, `src/constants/tools.ts`, `src/utils/forkedAgent.ts`.

### 5.1 Subagent definition (frontmatter)

| Field | Upstream | CCZ | Gap |
|---|---|---|---|
| `name`, `description`, `tools`, `disallowedTools`, `model` (+`inherit`), `permissionMode`, `effort`, `hooks`, `memory` (user/project/local), `skills`, `mcpServers` (inline + by name), `maxTurns`, `background`, `initialPrompt`, `isolation: worktree`, `color` | ✓ | ✓ parsed in `loadAgentsDir.ts` | none |
| `omitClaudeMd` | ✓ (2.1.271) | type + runtime honoured (`runAgent.ts:400`, Explore/Plan set it) but **not parsed from frontmatter** | **fix** |
| `experimental.cacheTtl: 5m\|1h` | ✓ | absent | skip (Anthropic-only cache TTL) |
| `Agent(worker, researcher)` in `tools` to restrict spawnable types | ✓ | ✓ (`allowedAgentTypes`) | none |

### 5.2 Runtime knobs

| Knob | Upstream | CCZ | Gap |
|---|---|---|---|
| Nested subagents, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default **3**; `1` disables) | ✓ (2.1.219) | AgentTool hard-removed from every subagent for non-ant builds (`ALL_AGENT_DISALLOWED_TOOLS`); no depth counter (`queryTracking.depth` counts query turns, not agent nesting) | **fix**: `ToolUseContext.agentDepth`, env + `maxSubagentDepth` setting |
| Concurrent limit `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20) | ✓ | none | **fix** |
| `CLAUDE_CODE_SUBAGENT_MODEL` / `_FORCE` | ✓ | `SUBAGENT_MODEL` only | **fix** `_FORCE` |
| `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS` | ✓ | absent (only `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS`) | **fix** |
| Subagent output scanning (escape text that imitates `<system-reminder>` etc., marker line on permission-mode mentions) — 2.1.210 | ✓ | absent | **fix** (prompt-injection hardening) |
| Fork / `/subtask` / resume via `SendMessage` / sibling roster / per-agent memory / worktree isolation / SubagentStart|Stop hooks / `--agent` main-session | ✓ | ✓ | none |
| Background row cleared after 30 s, Ctrl+B to background | ✓ | ✓ | none |
| Agent map (VS Code), `(+N)` tree display in `/tasks` | ✓ | flat list | skip (UI) |

### 5.3 Tools

| Tool | Upstream | CCZ |
|---|---|---|
| Core file/shell/search/web/agent/task/plan/skill/MCP/Monitor/Artifact/Notebook/LSP | ✓ | ✓ (60 tools incl. CCZ-only ImpactAnalysis, WikiSearch, LocalMemoryRecall, VaultHttpFetch, TerminalCapture, WebBrowser, ListPeers, Tungsten) |
| `ToolSearch` (deferred tool loading) | ✓ | `SearchExtraToolsTool` + `ExecuteTool` (same idea, different name) |
| `SubagentHandback` (subagent hands control back to parent mid-run) | ✓ | absent — needs the SDK handback protocol; skip until an SDK consumer asks |
| `WaitForMcpServers` | ✓ | absent — `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` covers the headless case; skip |
| `ScheduleWakeup` (`/loop` dynamic pacing) | ✓ | `SleepTool` + `ScheduleCronTool` + `/loop` skill — equivalent |
| `EndConversation`, `DesignSync`, `ArtifactComments/Data`, `RemoteTrigger` | claude.ai-tied | `RemoteTriggerTool` only; rest skip |
| Tool result persistence (`maxResultSizeChars`, disk spill + preview), per-message budget | ✓ | ✓ (+ `toolResultMaxChars` setting from Phase 2) |

### 5.4 Other harnesses — subagent model

- **Codex** multi-agent v2: per-thread delegation policy (done: `subagentDelegation`), nested-token budgeting (already counted), `codex agents` dashboard (`/list-agents` now), Interrupt hooks (done).
- **OpenCode**: `subagent_depth` config (→ same as `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`).
- **Amp/Droid**: named specialist agents (Oracle/Librarian; Knowledge/Reliability) — CCZ ships Explore/Plan/general-purpose/verification/claude-code-guide/statusline; a `librarian` (external-docs) agent is the one obvious addition, deferred.

### 5.5 Skipped earlier, now scheduled

1. Subagent depth + concurrency (5.2) — replaces the earlier "skip 6.1".
2. Auto-mode refusal of nested `$( $( ) )` / backtick-in-`$()` expansions (upstream 2.1.273) — deny instead of classify when auto mode is active.
3. Vim: `/` in NORMAL mode opens the transcript search; `Ctrl+R` redo.
4. Esc cancels a running SessionStart hook at startup.

---

## 6. System prompt & terminal UI — focused pass (added 2026-09-17, third round)

Sources: [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) (extracted from v2.1.274) vs `src/constants/prompts.ts`; upstream changelog vs `src/components/Spinner*`, `src/screens/REPL.tsx`.

### 6.1 System prompt

CCZ's main prompt is the ~2.1.12x text with a few ant-only sections un-gated. Upstream since then replaced the long `# System` block with a 5-bullet `# Harness` block and added short behavioural sections. Diff:

| Upstream section (tokens) | CCZ | Gap |
|---|---|---|
| `# Harness` (299) — lean: markdown, permission mode, system-reminder, hooks-as-feedback, prefer dedicated tools + parallel calls, `file:line` refs | `# System` block (~600 tk) with a 4-bullet SearchExtraTools/ExecuteExtraTool tutorial | keep the deferred-tool guidance (CCZ-specific) but add "parallel tool calls" + "hook output = user feedback" lines |
| `# Corrections` (365) — don't over-self-correct, evaluate other agents' corrections | absent | **add** |
| Act when ready (68) — act on enough info, give a recommendation not a survey | absent | **add** |
| `# Delivering work` (605) — full scope, assumptions not blocking questions, refusals only for real harm | partially (`Default to helping…`) | **add** the section |
| Action safety + truthful reporting (161) — short form | long `# Executing actions with care` (1105) ✓ + faithful-reporting bullet ✓ | none |
| Exploratory questions → analyze before implementing (75) | absent | **add** |
| Frontend browser verification (86) | absent | **add** (conditional on Chrome/WebBrowser tool present) |
| Focus mode notice (105) — "user only sees your final text" | `/focus` exists (Phase 5) but the model isn't told | **add**, post-boundary |
| Fork usage guidelines (326) — don't peek / don't race | in AgentTool description (`whenToForkSection`) ✓ | none |
| Concise output style (373) — built-in style | only Explanatory / Learning | **add** built-in |
| Communication style (297) — includes "end-of-turn summary: 1–2 sentences", "no planning docs unless asked" | longer CCZ version, missing those two lines | **add** the two lines |
| Help & feedback (24) | bullet still points at `/share` + Anthropic Slack channel `C07VBSHV7EV` (flagged `TODO` in source) | **fix**: `/feedback` + `MACRO.ISSUES_EXPLAINER` |
| Memory instructions (487 + pointers) | CCZ layered memory has its own prompt | none |
| Model identity (Fable 5 / 5.1) | — | out of scope (no Claude 5) |

### 6.2 Terminal UI

| Upstream | CCZ | Gap |
|---|---|---|
| Spinner "deep in thought" after 45 s of thinking; "picking the thought back up" on output-token-limit resume (2.1.271) | `thinking…` / `thought for Ns` only | **add** both |
| Hook progress row, Esc cancels SessionStart | done (Phase 7 / 12) | — |
| `/focus` view | done (Phase 5) | prompt notice missing → 6.1 |
| `/diff` side-by-side panel, `/theme`, `/config` mouse, prompt-cache clock, `[⧉ …]` IDE pill, agent `(+N)` tree | `DiffDialog` ✓; theme ✓; mouse hits exist; cache clock ✗ (Anthropic TTL-specific); IDE pill ✗; tree ✗ | skip — cosmetic / Anthropic-specific |
| Clickable `file://` paths (OSC 8) | ✓ (7 hits) | none |
| Concise style in `/output-style` picker | ✗ | via 6.1 |
| Terminal progress OSC 9;4 (iTerm/Ghostty/ConEmu) | ✓ (4 hits) | none |

### 6.3 Plan

- **Phase 13 — prompt**: 13.1 feedback bullet fix; 13.2 add Corrections / Act-when-ready / Delivering-work / exploratory-questions / frontend-verification; 13.3 focus-mode notice (post-boundary, reads `focusMode`); 13.4 Concise built-in output style; 13.5 two missing communication-style lines + "parallel tool calls" + "hook output = user feedback" harness lines.
- **Phase 14 — UI**: 14.1 "deep in thought" after 45 s; 14.2 "picking the thought back up" via a new `CompactProgressEvent` `output_limit_resume` from the query loop.
