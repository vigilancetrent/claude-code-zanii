# ChatGPT subscription implementation design

Scope: the approved native OpenAI auth-mode integration, one active local account. The existing Bun/TypeScript CLI owns conversation history, local tools and permission decisions. OAuth and inference are delegated to OpenAI; adding Codex as a second agent is outside this design.

## Architecture

Direct CLI entry: `auth login --chatgpt` delegates to the same local OAuth, protected storage and catalog services as `/login`. Existing enterprise login constraints and incompatible flags must be rejected before side effects. The browser remains the only place for credentials and consent. Cancellation closes the listener; failed grant/catalog/persistence cannot activate subscription mode. Account plan names are never admission rules in Zanii; OpenAI checks granted permission and request eligibility. No additional inference is sent during sign-in.

Both login paths share subscription activation. Effective settings are reread after writing user preferences; higher-priority project/local/flag/managed provider or auth-mode overrides produce a clear failure rather than a false success. Host-managed routing cannot be changed by login. The direct command owns cancellation only while its listener is active; existing global SIGINT/SIGTERM dispatchers must defer so cleanup runs before the CLI exits.

`/login -> app-owned PKCE loopback -> signed identity and granted scope -> protected local registration/tokens -> existing OpenAI Responses adapter -> existing query/tool permission loop -> transcript metadata -> next request`.

Main and auxiliary requests share authentication and the public Responses endpoint. Subscription credentials never reach user-configured OpenAI-compatible hosts. Native output metadata belongs to the validated account/provider/model context; complete Responses items survive local tool continuation and transcript reload without reconstructing encrypted reasoning. Token counts remain measured usage, and subscription requests are excluded from API-dollar estimates.

Scaling axis: independent local CLI processes sharing one app-owned credential registration. Serialize refresh and logout across processes with bounded file locks and atomic writes. There is no hosted service, tenant database, public account proxy or queue in this change. Failure domains are the local credential store, browser/loopback callback, network and OpenAI admission/inference. A provider failure stops that request; it never silently changes billing credentials.

## Threat model

External input boundaries: OAuth callback, token/JWKS/model responses, Responses events, persisted auth/history data and environment configuration. Credentials are secrets; account identity and transcript content are personal data. Tokens remain in app-owned protected storage, never settings, diagnostic bodies or fixtures. Stable registration metadata is retained after logout; personal tokens are cleared and revocation is attempted.

| Threat | Control and verification |
|---|---|
| OAuth callback spoofing or mix-up | Bind loopback on 127.0.0.1; validate state, nonce, PKCE, issuer, audience, signed identity, expiry and callback size; reject invalid callbacks in tests. |
| Borrowed Codex registration or unintended billing | Remove Codex credential fallback; require fresh app-owned consent and direct plan-use scope; fix subscription endpoint; test no API-key fallback. |
| Rotated refresh token races or logout resurrection | Cross-process locking, atomic protected persistence and serialized logout; test concurrent renewal and logout. |
| Tokens in logs, arbitrary hosts or errors | Fixed HTTPS auth/inference origins, safe error summaries/request IDs, no raw credential body logging; adversarial error tests and secret scan. |
| Truncated or forged tool streams | Validate framing and event bounds, require successful terminal response, complete function arguments and unchanged permission gate; abort/EOF/failure tests. |
| Reasoning replay under another account | Bind opaque items to account/provider/model, deduplicate split messages and test mismatched contexts and reload. |
| Unbounded resource use | Deadlines, bounded callback/event/model bodies and lock waits, stream cleanup/cancellation; local deterministic concurrency measurements. |

Verification: focused Bun unit/integration tests with generated test identities and mocked external calls, actual typecheck/lint/full test/build commands, then a 47-row readiness report with measured local results. Live user consent, actual account eligibility and service capacity cannot be established by mocked tests and must remain explicitly unverified until exercised. No account credentials are inspected to bypass the user's consent flow.
