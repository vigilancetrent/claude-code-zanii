# Codex integration alternatives and local feasibility

Research date: 2026-10-24. Planning only. No application source or personal credentials were changed or inspected.

## Which integration fits subscription inference?

### Takeaway

Preserve the existing native model-provider path and migrate its authentication and transport to the documented Sign in with ChatGPT contract, subject to eligibility verification. A Codex process is a separate agent harness; adding one is justified only if the product later needs Codex's execution behavior and thread history.

### Cited Findings

- Native support already exists: `chatgptAuth.ts` provides device login, refresh, auth removal and a fallback that reads Codex's credential file; `responsesAdapter.ts` calls the private `chatgpt.com/backend-api/codex/responses` endpoint and supplies browser origin headers. This is existing functionality to audit and migrate, not a greenfield provider. [Authentication source](../../src/services/api/openai/chatgptAuth.ts:197), [fallback](../../src/services/api/openai/chatgptAuth.ts:339), [transport](../../src/services/api/openai/responsesAdapter.ts:471).
- Current first-party guidance offers three integration levels: noninteractive `codex exec`, a programmatic SDK, and app-server for interactive product integration. These control Codex's agent harness, with the product owning the surrounding workflow. [Codex platform guidance](https://developers.openai.com/blog/codex-as-a-platform).
- The TypeScript SDK supports starting and resuming local threads and requires server-side Node.js 18+. Its docs direct custom clients needing authentication, approvals, conversation history and streamed agent activity to app-server. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).
- App-server uses its own bidirectional JSON-RPC contract: initialize, thread/start or thread/resume, turn/start, item notifications and turn/interrupt. It can issue command/file approval requests and expose token usage; these are agent-level operations. Stdio uses JSONL. Its command and WebSocket transport are currently described as experimental and unsupported for production workloads. [App-server protocol](https://learn.chatgpt.com/docs/app-server).
- The documented subscription configuration can give app-server an app-owned OAuth access token via child environment and configure `https://api.openai.com/v1` with Responses transport. Refreshing that external environment token requires restarting app-server and resuming its saved thread. Model listing can return a bundled catalog rather than proving access; completed inference verifies the requested access. The guide says the app should read its own token file. [ChatGPT plan app-server configuration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
- `codex exec --json` returns JSONL agent activity with terminal success/failure and usage events. It reuses saved CLI authentication by default, supports explicit session resume and normally requires a Git repository. It defaults to read-only sandboxing. This is appropriate for jobs, not a model-only substitution. [Noninteractive Codex](https://learn.chatgpt.com/docs/non-interactive-mode).
- Hosting Codex as MCP is no longer a current option: both `codex mcp-server` and the standalone binary were removed. App-server is not an MCP drop-in, though Codex still consumes external MCP tools. [MCP server removal](https://learn.chatgpt.com/docs/mcp-server).

### Inferences

- **Recommended:** repair/migrate the native ChatGPT auth and Responses adapter. The existing CLI remains responsible for tool invocation, file edits, permission prompts and transcript persistence; only inference/authentication need change.
- **Defer:** app-server as a visibly separate agent mode, if later requested. Integrating it behind a model selector would conceal changes in tool ownership, sandbox rules, approval semantics and transcript format.
- **Defer:** SDK or exec as a bounded delegated task, if later requested. An additional agent is unnecessary to meet the user's clarified subscription-only goal.
- **Reject:** adding Codex MCP hosting or treating the existing ACP bridge as an app-server transport without protocol translation.
- Importing and independently refreshing Codex's credentials can create competing owners of token renewal and make logout ambiguous. This is a risk inferred from the current fallback and the official app-owned lifecycle; no refresh collision was executed or observed.

### Gaps

- The research does not establish this user's account eligibility or the project's admission to direct subscription usage. The subscription researcher covers exact preview requirements.
- No live request verified the existing private route; availability or permission must not be inferred from code presence.
- No Bun support guarantee for the Codex SDK was found in its published Node requirement. A Bun smoke test would be needed if that deferred path is selected.

## Can the current ACP and remote-control bridge host Codex unchanged?

### Takeaway

No. The existing bridge speaks ACP, while Codex app-server uses a different RPC vocabulary. Keeping the native provider lets current ACP clients gain the model through the existing Claude agent without adding a Codex bridge.

### Cited Findings

- `acp-link` spawns a configured command, wraps its stdio in `acp.ndJsonStream`, constructs an ACP `ClientSideConnection`, then negotiates ACP capabilities. A configurable executable is therefore not enough to support an arbitrary JSONL agent. [Connection implementation](../../packages/acp-link/src/server/handlers-agent.ts:55).
- The session handler calls ACP `newSession`, `loadSession`, `unstable_resumeSession`, `prompt`, `cancel` and model-selection methods, with capability checks for history operations. [Session creation](../../packages/acp-link/src/server/handlers-session.ts:68), [load](../../packages/acp-link/src/server/handlers-session.ts:224), [resume](../../packages/acp-link/src/server/handlers-session.ts:292), [cancellation](../../packages/acp-link/src/server/handlers-session.ts:367).
- The bridge forwards permission choices to its WebSocket client, times out pending permission requests to cancellation, and cancels outstanding requests on disconnect. Its `readTextFile` and `writeTextFile` client methods currently return empty/no-op results, which matters for any new agent relying on client-owned filesystem capabilities. [ACP client callbacks](../../packages/acp-link/src/server/acp-client.ts:19), [filesystem callbacks](../../packages/acp-link/src/server/acp-client.ts:52), [disconnect handling](../../packages/acp-link/src/server/acp-client.ts:95).
- The project's `--acp` agent entry creates an ACP `AgentSideConnection` around `AcpAgent` and applies its own configuration environment before serving. This is the existing project agent, not an adapter for external Codex. [ACP entry](../../src/services/acp/entry.ts:27).
- RCS exposes registered ACP agents and channel groups and relays their transport; no Codex-specific runtime or protocol translator was found in the examined ACP/RCS source. [ACP routes](../../packages/remote-control-server/src/routes/acp/index.ts:75), [relay](../../packages/remote-control-server/src/transport/acp-relay-handler.ts:59).

### Inferences

- Native subscription inference is the smallest complete solution: reuse `--acp` and RCS through their existing agent path. Do not include ACP/RCS changes in the initial subscription milestone.
- A later Codex agent mode would require an explicit adapter between Codex thread/turn/item events and ACP session/update messages, plus approval decisions, cancellation, errors, model lists and lifecycle management. It needs independent integration tests; existing JSONL framing does not prove compatibility.
- Any such adapter must keep the two transcript stores distinct and map a project session to a Codex thread ID rather than interpreting one format as the other.

### Gaps

- No first-party source establishing native ACP support in the current Codex executable was found. Do not promise direct `codex --acp` support based on third-party adapters.
- RCS browser behavior and client-side filesystem capability advertisement were not tested; only the implementation boundaries relevant to this decision were inspected.

## What is locally feasible and what must be verified before release?

### Takeaway

The local toolchain is suitable for investigating the current TypeScript/Bun implementation. Subscription success remains unverified; the next implementation gate should be one authenticated, tool-using conversation through the documented route, with safe cancellation and no automatic change of billing path.

### Cited Findings

- Root `package.json` declares Bun >=1.3.0, TypeScript strict-check scripts, the installed OpenAI SDK, and the ACP SDK. It does not declare the Codex SDK. The ACP-link package separately supports Node >=18. [Root manifest](../../package.json), [ACP-link manifest](../../packages/acp-link/package.json).
- Metadata commands returned Bun 1.3.14, Node v24.19.0 and Codex CLI 0.164.0. PowerShell resolved `codex` to a blocked `.ps1` shim; `codex.cmd --version` worked, with sandbox access warnings for Codex temp/PATH cleanup. No inference or login was launched. Evidence: this research session's read-only `Get-Command` and version command outputs.
- `git log -3 --oneline` returned “not a git repository” in the specified workspace, and no `.git` entry was listed. Recent history could not be reviewed. Evidence: this research session's read-only Git and directory commands.
- Windows-native Codex execution is officially supported with native sandbox options, subject to host capabilities and managed policy. WSL is not inherently required. [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox).
- Existing auth derives Codex's default credential path from `HOME`, while its own app configuration uses `homedir()`. It also removes only the app's own file on logout but immediately permits fallback to Codex credentials during the next token read. Both are concrete behaviors to reconsider when replacing the implicit credential import. [Path resolution](../../src/services/api/openai/chatgptAuth.ts:42), [logout/fallback](../../src/services/api/openai/chatgptAuth.ts:331).

### Inferences

- Proposed rollout: (1) prove app/account eligibility and official contract; (2) migrate the existing native auth/transport and add consent-aware account status; (3) verify streaming text, a permission-controlled tool call, tool result continuation and cancellation; (4) exercise expiry, refresh, revoke/logout, quota and unavailable-model cases; (5) run provider regression tests, typecheck, lint and full relevant suite/build before enabling for users.
- Keep tokens out of logs and ordinary settings, make account selection explicit, and avoid silently switching to API-key billing on subscription errors. Authentication migration should retain the existing user-visible `OPENAI_AUTH_MODE=chatgpt` route where practical.
- If a future Codex runtime is chosen, executable resolution needs Windows `.cmd` handling or a direct native executable, argument-array spawning, and schema/version compatibility tests. Do not change machine execution policy as part of the integration.

### Gaps

- No test suite, live sign-in, token refresh, membership request, sandboxed agent run, Windows app-server startup, or cross-platform packaging check was performed. This was a planning investigation.
- Existing Git baseline and account-specific entitlements are unavailable. No success claim should be made until the implementation proof is run.
