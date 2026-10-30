# Kimi Code subscription

Use a Kimi Code (Moonshot) subscription instead of an API key.

## Sign in

```
claude auth login --kimi
```

Or run `/login` and choose **Continue with Kimi**. The CLI prints a
`kimi.com/code/authorize_device` link and a short user code; approving it in the
browser completes sign-in.

Sign-in uses Kimi's RFC 8628 device-code flow against `https://auth.kimi.com`
with Kimi's public Kimi Code client id. There is no ID token, so no identity
verification — the access token is the credential.

## What gets configured

`activateKimiSubscription()` writes user settings:

```json
{ "modelType": "openai", "env": { "OPENAI_AUTH_MODE": "kimi" } }
```

Inference then goes through the existing OpenAI Chat Completions path to
`https://api.kimi.com/coding/v1` with:

- `max_completion_tokens` instead of `max_tokens` (Kimi shares the budget with
  `reasoning_content`)
- `thinking: { "type": "enabled" }` — Kimi's own field only, no DeepSeek extras
- thinking blocks replayed as `reasoning_content` on tool-continuation turns
- `User-Agent: claude-code/<version>` (the app's own UA; Kimi supports Claude
  Code as a third-party client)

## Tokens

- Stored at `$CLAUDE_CONFIG_DIR/kimi-auth.json` (default `~/.zaniicode`),
  protected with the same Windows DPAPI wrapper as ChatGPT credentials.
- Access tokens last 15 minutes; refresh tokens 30 days. Refresh happens inside
  a cross-process lock when the token is within 60 seconds of expiry.
- A rejected refresh (401/403/`invalid_grant`) clears the local credential and
  asks for `/login` again.

## Model selection

Claude tier names (`sonnet`, `opus`, `haiku`, `claude-*`) resolve to
`kimi-for-coding`, or `KIMI_MODEL` when set. An explicit Kimi model id passed
with `--model` or `/model` is sent unchanged. The `/model` picker still lists
the built-in Claude options, so prefer `--model kimi-for-coding` (or another id
from your plan) to pick a specific Kimi model.

## Sign out

`/logout` removes the local credential. Kimi exposes no public token revocation
endpoint, so revoke the device in your Kimi account if you need remote sign-out.

## Environment overrides

| Variable | Purpose |
| --- | --- |
| `KIMI_CODE_BASE_URL` | Override the managed endpoint |
| `KIMI_MODEL` | Default model for Claude-style tier names |

## Limits

- Model catalog discovery (`/models`) is not wired into the picker yet.
- Quota (`/usages`) is not displayed; Kimi's 5h/7d/monthly limits surface as
  429 errors from the endpoint.
- The endpoint's client allowlist is enforced server-side. If Kimi rejects this
  client, sign-in succeeds but the first prompt fails with a 403.
