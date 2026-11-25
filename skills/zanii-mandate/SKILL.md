---
name: zanii-mandate
description: >-
  Build, integrate, or audit AI agents that act on someone's behalf within limits, using
  Zanii Mandate: signed, scoped, expiring permissions checked before every tool call, with
  deny rules, count and amount limits, human approval, conditions, revocation and offline
  verification. Use this whenever a task involves letting an AI agent act for a person or
  company with limits, permissions or authorization for agents, "may the agent do X",
  revoking or suspending an agent's authority, human approval of agent actions, the
  @zanii/mandate-* npm packages, zanii-mandate-sdk on PyPI, or the Zanii Mandate Go or
  Java SDKs.
---

# Zanii Mandate: signed permissions for AI agents

A **mandate** says **who** lets **which agent** do **what**, **within which limits**, **until when**.
Money is only one kind of limit: a mandate can just as well cap how many emails an agent sends in an
hour, keep it away from health data, limit it to one country, require a manager before it signs a
contract, or stop it from deploying to production. The issuer signs the mandate (Ed25519); the
verify service checks every action against it and answers `allow`, `deny`, `review` or `error`.

| Area           | Mandate                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| Customer data  | "May read customer profiles in Dubai; may not export or delete"                |
| Communication  | "May email existing customers; at most 200 a day; no marketing"                |
| Health         | "May read this patient's lab results for 24 hours, with the patient's consent" |
| Government     | "May submit visa renewals for staff in this company; may not cancel"           |
| Legal          | "May draft contracts; signing needs a manager's approval"                      |
| Engineering    | "May deploy to staging; production needs a human"                              |
| Travel         | "May book flights for me up to economy, within these dates"                    |
| Agent to agent | "May hire a translation agent for this task only"                              |

Two services: the **Mandate API** (control plane, default port 8787: issue, revoke, approvals, API
keys, audit) and the **Verify API** (verification plane, default port 8788: verify, operations,
signed status lists, public keys; it holds no signing key). Both use scoped bearer API keys.

## Which package to use

Published (Apache-2.0): all **0.2.0** (30 October 2026; `@zanii/mandate-sdk` 0.2.1), except
`@zanii/mandate-verify-core` **0.3.0** (1 November 2026), which adds `verifyPassport`. They pin each
other exactly, so upgrade them together:

| Need                                                                                             | Package                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Node.js / TypeScript client: issue, verify, operations, offline verify (start here)              | npm `@zanii/mandate-sdk`                          |
| Pure offline verification engine (`verifyMandate`, `verifyOfflineTrustBundle`, `verifyPassport`) | npm `@zanii/mandate-verify-core`                  |
| Canonicalization (RFC 8785), Ed25519, `did:key`, mandate build/sign, action vocabulary           | npm `@zanii/mandate-core`                         |
| Pattern, amount and time-window helpers used by the verifier                                     | npm `@zanii/mandate-policy-engine`                |
| Signed revocation status lists                                                                   | npm `@zanii/mandate-status-list`                  |
| Python client (verify, operations, FastAPI and Django decorators); Python 3.12+, stdlib only     | PyPI `zanii-mandate-sdk` (import `zanii_mandate`) |

In the repository only, **not published** (use from a checkout):

- Go SDK 0.2.0 (`packages/sdk-go`, module `github.com/vigilancetrent/zanii-mandate/packages/sdk-go`,
  no tag, private) and Java SDK 0.2.0 (`packages/sdk-java`, `agency.zanii:mandate-sdk:0.2.0`, built
  locally, not on Maven Central). See `reference/go-java.md`.
- Enforcement adapters: `@zanii/mandate-middleware-express` (Express and Fastify),
  `@zanii/mandate-mcp-proxy`, `@zanii/mandate-gateway-{aws,cloudflare,envoy,blackbox}`, the Kong and
  Apigee plugins, Gin middleware, agent-framework adapters, `policy-packs`, `id-adapter` and
  `@zanii/mandate-zanii-bridge`. None of these is on npm; never write `npm install` for them.

Install: `npm install @zanii/mandate-sdk@0.2.0 @zanii/mandate-verify-core@0.2.0` (Node 24+) and
`pip install zanii-mandate-sdk==0.2.0` (extras `[fastapi]`, `[django]`). For `verifyPassport`,
install `@zanii/mandate-verify-core@0.3.0` and import it from there.

## The core flow (memorize this)

1. **Issue** (control plane, scope `mandates:issue`): `POST /v1/mandates` with `agentDid`, `actions`,
   `resources`, `constraints`, `expiresAt`. The response has `mandate.id` (`urn:zanii:mandate:...`).
2. **Verify before every tool call** (scope `verify`): send only `mandateId` and the action `request`.
   Act only on `verdict === 'allow'`. `deny`, `review` and `error` are returned values, not
   exceptions, and none of them may execute the action.
3. **For actions with side effects use the operation flow** (scope `operations:write`, PostgreSQL
   deployments): reserve, dispatch, run the tool, then commit, or mark unknown. Only a fresh
   `verdict: 'allow'` with `state: 'dispatched'` is permission to execute. Here a deny is thrown
   (`MandateApiError`, 409, `details` = reasons) and review comes back as `state: 'held'`.
4. **Revoke or suspend** (scope `mandates:revoke`): the next verification after the status list
   refreshes denies with `MANDATE_REVOKED` / `MANDATE_SUSPENDED`.

```ts
import { MandateClient, REASON_CODES } from '@zanii/mandate-sdk';

const issuer = new MandateClient({
  mandateBaseUrl: 'http://localhost:8787',
  apiKey: process.env.ZANII_API_KEY,
});
const { mandate } = await issuer.issue(
  {
    agentDid: 'did:zanii:agent:support',
    actions: ['email.read', 'email.draft', 'email.send'],
    resources: ['mailbox:support', 'recipient:customer:*'],
    constraints: {
      maxCount: { value: 20, period: 'hour' },
      deniedActions: ['email.campaign'],
      deniedDataClasses: ['marketing', 'health'],
    },
    expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  },
  { idempotencyKey: 'issue-support-agent-2026-10-30' },
);

const verifier = new MandateClient({
  verifyBaseUrl: 'http://localhost:8788',
  apiKey: process.env.ZANII_API_KEY,
});
const decision = await verifier.verify(
  {
    mandateId: mandate.id,
    request: {
      agentDid: 'did:zanii:agent:support',
      action: 'email.send',
      resource: 'recipient:customer:4411',
      dataClass: 'confidential', // the mandate denies data classes, so say which one this is
    },
  },
  { operationId: 'ticket-8812-reply-1' }, // stable per business action; sent as Idempotency-Key
);
if (decision.verdict !== 'allow') {
  const codes = decision.reasons.map((r) => r.code);
  if (codes.includes(REASON_CODES.APPROVAL_MISSING)) {
    /* route to a human approver */
  }
  return; // never execute on deny, review or error
}
```

```python
import os
from zanii_mandate import MandateClient, codes

client = MandateClient(verify_base_url="http://localhost:8788", api_key=os.environ["ZANII_API_KEY"])
decision = client.verify(
    {"mandateId": os.environ["ZANII_MANDATE_ID"],
     "request": {"agentDid": "did:zanii:agent:support", "action": "email.send",
                 "resource": "recipient:customer:4411", "dataClass": "confidential"}},
    operation_id="ticket-8812-reply-1",
)
if decision["verdict"] != "allow":
    if any(r["code"] == codes.APPROVAL_MISSING for r in decision["reasons"]):
        pass  # route to a human approver
    raise SystemExit("not allowed")  # never execute on deny, review or error
```

The Python SDK talks to the Verify API only; issue mandates with the TypeScript client or a plain
`POST /v1/mandates` (see `reference/python.md`).

## The rule that matters most: unknown outcomes

`isUnknownOutcome(error)` (Python `is_unknown_outcome`, Go `mandate.IsUnknownOutcome`, Java
`MandateError.isUnknownOutcome`) is true when the server answered `DATABASE_COMMIT_UNKNOWN` (HTTP 503:
the database connection dropped during COMMIT, so the write may or may not have landed) or when a
timeout or transport failure happened after the request may have reached the server. A refused
connection or DNS failure is false. When it is true:

1. **Never redo the business action** (payment, email, write). The action may already have happened.
2. Mark the operation unknown (`markOperationUnknown` / `mark_operation_unknown`) or read it back with
   the **same operation ID** (`getOperation`, TypeScript only). Re-sending the same `verify` with the
   same operation ID replays the stored verdict; re-sending the identical commit body is a stored
   replay too. Reconcile later; an `unknown` operation can still be committed.

## Rules you MUST follow when writing Mandate code

1. **Verify before every tool call, and act only on `allow`.** HTTP 200 does not mean allow; read
   `verdict`. `review` is not allow. Codes are open strings: an unlisted code is never success.
2. **Operation IDs are stable business identifiers**, 1 to 200 characters, no line breaks. Reuse one
   only for an identical retry; never mint a new one per retry. Reusing it with a different body is
   `409 IDEMPOTENCY_MISMATCH` (verify) or `OPERATION_MISMATCH` (operations). `verify` and
   `verifyBatch` require it (TS `{ operationId }`, Python `operation_id=`).
3. **Send only allowed request fields**: `agentDid`, `action`, `resource`, `amount`, `dataClass`,
   `jurisdiction`, `approvalId`, `approvalIds` (at most 10) and the condition context `dataSubject`,
   `counterpartyDid`, `dataRegion`, `destination`, `transferSafeguard`. Anything else, for example
   `request.context`, `pins`, `now`, `periodCount` or a raw `mandate`, is `400 UNSUPPORTED_FIELD`.
4. **Send the facts the mandate limits.** With `allowedDataClasses`/`deniedDataClasses` send
   `dataClass`, with `allowedJurisdictions` send `jurisdiction`, with a money limit send `amount`;
   a missing fact gives `review` (`DATA_CLASS_UNKNOWN`, `JURISDICTION_UNKNOWN`, `AMOUNT_UNKNOWN`).
5. **Amounts are decimal strings** with the currency's minor units: `{ value: '250.00', currency:
'AED' }`, never a float. Python canonical arguments also need decimal strings, not floats.
6. **Deny rules win** over `actions`/`resources` and are inherited by delegated children.
7. **`maxCount.period` is `minute`, `hour`, `day` (default) or `month`, as UTC calendar windows**, not
   rolling windows. `maxAmount.period` is `transaction`, `day` or `month`.
8. **Named role approvers (`did:zanii:role:...`) match only the name of the approving API key, which
   an administrator assigns**, never a display name. A person approves a role through a `group:`
   mapping (Zanii ID groups). The key that issued a mandate cannot approve it.
9. **Through `POST /v1/verify` a missing approval is a deny** (the default server sets
   `requireApproval`); the operation flow holds the action (`state: 'held'`, `verdict: 'review'`).
10. **Conditions fail closed.** A condition with no registered provider denies with
    `CONDITION_PROVIDER_MISSING`; a failed check with `CONDITION_NOT_MET`; an error, timeout or
    malformed result with `CONDITION_ERROR`. Providers are opt-in (`MANDATE_CONDITION_PROVIDERS`).
11. **Mandates longer than 7 days need `maxStatusAgeSeconds`** (1 to 3600) at issue, and the
    deployment must allow the length (`MANDATE_MAX_VALIDITY_DAYS`, default 7, up to 365). Stale
    status fails closed (`STATUS_STALE`).
12. **Offline verification is never a dispatch permit.** `verifyLocal` results carry `offline: true`
    and `dispatchPermit: false`; quotas and approvals need the online service.
13. **Keep the published packages on one version.** `@zanii/mandate-sdk` 0.2.x pins
    `@zanii/mandate-verify-core` 0.2.0, which pins `mandate-core`, `mandate-policy-engine` and
    `mandate-status-list` 0.2.0. Upgrade them together; `verify-core` 0.3.0 only adds `verifyPassport`.
14. **A parent's budget binds all its children together.** Sibling mandates of one parent share the
    parent's count and amount limits on both `POST /v1/verify` and the operation flow (servers from
    1 November 2026). A child under its own limit can still be denied `COUNT_LIMIT_EXCEEDED` or
    `AMOUNT_LIMIT_EXCEEDED` because the parent's is used up.
15. **API keys are secrets.** Raw keys are shown once at creation; load them from the environment or
    a secrets manager, never hardcode or log them. Spans and errors never contain bearer tokens or
    request bodies; keep your own logs the same.

## Load these references when the task needs depth

- `reference/concepts.md`: mandate fields, constraints, deny rules, counts, approvals, conditions and
  the five Zanii condition providers, delegation, validity and status freshness, offline bundles,
  the action vocabulary, the 10 policy packs, Zanii ID integration.
- `reference/typescript.md`: `MandateClient` options and every method, errors, reason codes, the
  operation flow with `canonicalize`/`sha256Hex`, `verifyLocal`, caches, tracing, Express/Fastify.
- `reference/python.md`: `zanii_mandate` client, errors, codes and types, the operation flow,
  FastAPI and Django decorators, issuing over HTTP.
- `reference/go-java.md`: the unpublished Go and Java SDKs.
- `reference/patterns.md`: patterns (approval loop, retries, reconciliation, MCP and gateway
  enforcement) and the mistakes models make.
