# Use your ChatGPT plan in Zanii

Zanii can authorize eligible model requests with your own ChatGPT account. This is a local, single-account integration using OpenAI's public Responses API. It does not require an OpenAI API key, import Codex sessions, share memberships, or provide unlimited usage. Account, workspace, model and regional eligibility are checked by OpenAI.

Any ChatGPT account may attempt sign-in. Zanii does not require Pro or gate on a plan name. Successful sign-in does not guarantee subscription inference: OpenAI determines whether the account/workspace has plan-use permission and request access. API-key access remains a separate explicit choice.

## Connect

For direct browser sign-in after `bun run build`, run this in your own terminal from the project directory:

```powershell
bun dist/cli-bun.js auth login --chatgpt
bun dist/cli-bun.js auth status --text
bun dist/cli-bun.js
```

The first command opens the browser and also prints a fallback link. Complete sign-in and allow plan usage there; press Ctrl+C in the terminal to cancel. It selects subscription mode only after the grant and account catalog are validated. In the interactive CLI, choose `/model` and send a small message to verify actual inference. After installing the package, the equivalent command is `ccz auth login --chatgpt`.

The direct command respects enforced enterprise login settings. It cannot be combined with Anthropic-specific login flags (`--console`, `--claudeai`, `--sso`, `--email`). It sends no model request during sign-in. If Windows startup reports registry/credential subprocess permission errors in a restricted automation environment, run the command in your normal Windows terminal; do not disable managed policy or credential protection.

Host-managed provider routing cannot be changed through this command. If a higher-priority project, local, command-line or managed setting overrides the subscription choice, login reports that conflict instead of claiming the mode is active. Resolve the relevant setting deliberately, then retry; the app does not overwrite it.

Alternatively, use the existing interactive flow:

1. Install the locked dependencies with `bun install --frozen-lockfile`, then start `bun run dev`.
2. Run `/login` and select **Continue with ChatGPT**.
3. Complete the browser sign-in and allow **ChatGPT plan usage**. The browser returns to a temporary listener on `127.0.0.1`; return to the terminal afterward. Press Esc to cancel.
4. Acknowledge the first-use plan notice. Run `/model` to choose from the connected account's catalog.
5. Send a small message. A completed response verifies access for that particular model/request; a successful sign-in or model listing alone does not.

If an extracted Windows checkout has missing package aliases or optional tooling, reinstall with `bun install --frozen-lockfile --ignore-scripts --backend=copyfile --linker=hoisted --force`. This changes the installation layout without changing dependency versions. The normal build is `bun run build`.

Consent to sign in and consent to use the plan are separate. Identity-only consent remains a connection but cannot run models. Reconnect with `/login` to grant plan usage. Do not paste browser cookies, Codex tokens or API keys into this flow.

## Models, tools and conversations

The picker loads the visible account catalog from `https://api.openai.com/v1/models`, caches it locally in memory for five minutes, and refreshes after account changes. Server order supplies the default once discovered. Explicit model choices are preserved; catalog presence does not guarantee entitlement. Existing API-key mode and its compatible-server settings remain available through their own explicit login choice.

Zanii owns local tool execution and permission prompts. OpenAI proposes functions in a namespace; Zanii validates a successful terminal response before handing complete tool calls to the existing permission pipeline. Cancellation, failed/incomplete responses and premature stream termination cannot execute partial proposals.

Native response items, including encrypted reasoning, are stored with the assistant message and retained for tool continuation and transcript reload. They are bound to the app registration/account and model. Start a new conversation when changing that context; do not edit the opaque items in exported or saved transcripts. Full compaction can discard old history while retained messages keep their native state. If partial compaction removes only part of a native response, replay is rejected rather than restoring removed content; choose a complete response boundary or start a new conversation.

Model-specific context/output limits are used when supplied in the catalog. Missing metadata uses compatibility budgeting estimates, not a statement about plan quotas or actual model limits. The 1M context toggle is unavailable in subscription mode; a saved `[1m]` suffix cannot override account metadata. The subscription route does not forward unsupported generation parameters such as `max_output_tokens` or `temperature`.

## Usage and sign-out

`/cost` reports measured token usage and labels subscription mode separately from recorded API costs. Subscription requests do not receive estimated API-dollar charges. If the session contains earlier API-key requests, their recorded costs remain visible.

`/usage` and the model picker link to [Manage usage in ChatGPT](https://chatgpt.com/settings/usage). They do not fetch Anthropic utilization or fabricate a remaining subscription percentage. Limit errors stop the subscription request; the app does not silently use an API key or another billing account.

`/logout` clears app tokens and attempts remote revocation. If OpenAI cannot confirm revocation, the terminal explains that local sign-out completed and directs you to disconnect the app in ChatGPT settings. The selected subscription mode stays selected while disconnected, preventing an older saved API key from becoming active. Select API-key mode explicitly to change billing.

`ccz auth status --text` (or its JSON default) distinguishes the selected provider, the app-owned connection and plan-use permission. It does not claim that a paid plan guarantees request access.

## Credentials and recovery

Credentials belong to this app in `openai-chatgpt-auth.json` inside `CLAUDE_CONFIG_DIR`, or `~/.zaniicode` by default. Windows encrypts the record using the current user's DPAPI protection through a hidden PowerShell process; macOS/Linux use owner-only files and directories. Refresh and logout are serialized across CLI processes, and file replacement is atomic. Registration and the installation ID are retained on normal sign-out for reconnecting.

Old Codex-based records require fresh app consent. Zanii never reads, refreshes or deletes Codex's credential file. Reconnecting reuses the single existing account/workspace registration; managing multiple registrations or selecting a different ChatGPT account is outside this milestone. If an app credential record is corrupt or cannot be decrypted on this device, use `/logout` to clear that app-owned record, then reconnect. A corrupt record cannot be remotely revoked locally; disconnect the app in ChatGPT settings too.

Common recovery paths:

| Symptom | Action |
|---|---|
| Plan usage disabled | Reconnect and allow ChatGPT plan usage. |
| HTTP 401 or revoked grant | Sign in again with `/login`. |
| HTTP 403 or no account models | Check account/workspace eligibility and policy; do not substitute another token. |
| Usage limit | Open Manage usage and wait or adjust the permitted limit there. |
| Interrupted or failed response | Review the failure, then retry the turn deliberately. Incomplete tool calls were not committed. |
| Different account/model in saved reasoning state | Start a new conversation. |
| Windows credential protection unavailable | Use a Windows session where PowerShell and current-user DPAPI are available. The app fails closed instead of saving plaintext credentials. |

This flow requires a browser and a local callback. A hosted subscription proxy, unattended first-time device login and existing Codex-session imports are not part of this implementation.

## Verify

See [the change inventory](../chatgpt-subscription-changes.md), [verification record](../chatgpt-subscription-verification.md) and [readiness report](../readiness-report.md) for files changed, actual command results and remaining live-account checks. Focused tests use generated identities and simulated external services; they do not establish eligibility for your real subscription.

Run `bun run test:chatgpt` with Bun 1.3.13 or newer for the focused regression suite. It uses Bun's native per-file isolation, including the existing API-key regressions and restored shared-helper tests, without launching subprocess test wrappers. The normal full repository suite remains `bun test`.

Official contracts: [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [account lifecycle](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
