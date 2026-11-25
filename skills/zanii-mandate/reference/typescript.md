# Zanii Mandate: TypeScript / Node.js reference

Package: npm `@zanii/mandate-sdk` **0.2.0** (Node 24+, ESM, JSDoc types with `src/client.d.ts`; no
build step). It depends on `@zanii/mandate-verify-core` 0.2.0 exactly, which pins `mandate-core`,
`mandate-policy-engine` and `mandate-status-list` 0.2.0.

```sh
npm install @zanii/mandate-sdk@0.2.0 @zanii/mandate-verify-core@0.2.0
# add @zanii/mandate-core@0.2.0 when you build operation payloads (canonicalize, sha256Hex)
```

Entry points: `@zanii/mandate-sdk` (client, errors, codes), `@zanii/mandate-sdk/cache`
(`BoundedTtlCache`), `@zanii/mandate-sdk/offline` (re-exports `verifyOfflineTrustBundle`).

## Client

```ts
import { MandateClient } from '@zanii/mandate-sdk';

const client = new MandateClient({
  mandateBaseUrl: 'http://localhost:8787', // control plane (default)
  verifyBaseUrl: process.env.ZANII_VERIFY_URL, // verification plane (default http://localhost:8788)
  apiKey: process.env.ZANII_API_KEY, // or `token`; sent as Authorization: Bearer
  timeoutMs: 5_000, // default 10_000
  // maxResponseBytes (1 MiB), cacheCapacity (128), cacheTtlMs (5_000), clock, fetch, tracer, offlineVerifier
});
```

| Method                                                                                                                     | Route                                                                      | Scope                                          |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `issue(input, { idempotencyKey })`                                                                                         | `POST /v1/mandates`                                                        | `mandates:issue`                               |
| `list({ limit, status })`, `get(id)`                                                                                       | `GET /v1/mandates`, `/v1/mandates/{id}`                                    | `mandates:read`                                |
| `revoke(id, { reason, cascade })`, `suspend(id, body)`, `reinstate(id, body)` (third arg `{ idempotencyKey }`)             | `POST /v1/mandates/{id}/revoke` and so on                                  | `mandates:revoke`                              |
| `createApproval({ mandateId, action, expiresAt?, operationId?, argsDigest? }, { idempotencyKey })`, `approvals(mandateId)` | `/v1/approvals`                                                            | `approvals:create`, `approvals:read`           |
| `createApiKey({ name, scopes })`, `listApiKeys()`, `revokeApiKey(id)`                                                      | `/v1/api-keys`                                                             | `admin`                                        |
| `issuer()`, `summary()`, `whoami()`, `events({ limit })`, `verifyAudit()`                                                  | control plane reads                                                        | `keys:read`, `summary:read`, any, `audit:read` |
| `verify(input, { operationId })`                                                                                           | `POST /v1/verify`                                                          | `verify`                                       |
| `verifyBatch(items, { operationId })` (1 to 100 items)                                                                     | `POST /v1/verify/batch`                                                    | `verify`                                       |
| `reserveOperation(body)`                                                                                                   | `POST /v1/operations/reserve`                                              | `operations:write`                             |
| `dispatchOperation(id, body)`, `commitOperation(id, body)`, `markOperationUnknown(id, body)`, `cancelOperation(id, body?)` | `POST /v1/operations/{id}/dispatch`, `/commit`, `/unknown`, `/cancel`      | `operations:write`                             |
| `registerPendingReceipt(id, { receipt })`, `deliverReceipt(id, { receipt })`                                               | `/pending-receipt`, `/receipts` (needs receipt-issuer trust on the server) | `operations:write`                             |
| `getOperation(id)`                                                                                                         | `GET /v1/operations/{id}`                                                  | `operations:read`                              |
| `keys()` / `resolveKeys({ forceRefresh })`, `status(listId)` / `resolveStatus(listId, { forceRefresh })`                   | `GET /v1/keys`, `/v1/status/{listId}`                                      | none (public, cached)                          |
| `verifyLocal({ bundle, request, trustAnchors, maxStatusAgeSeconds, statusCheckpoints, now })`                              | none (offline)                                                             | none                                           |
| `cacheStats()`                                                                                                             |                                                                            |                                                |

Every POST sends an `Idempotency-Key`: `verify`/`verifyBatch` use the operation ID; `issue`,
lifecycle and approval calls use the `idempotencyKey` you pass (pass one, otherwise each call gets a
random key and a retry is a new request); operation lifecycle calls get a fresh transport key because
the operation ID in the body or path already makes them idempotent on the server. Any POST may also
take `timeoutMs`. A replayed response has `idempotencyReplayed: true`.

## Verify and handle the verdict

```ts
import { MandateClient, REASON_CODES } from '@zanii/mandate-sdk';
import type { VerifyInput } from '@zanii/mandate-sdk';

const input = {
  mandateId: process.env.ZANII_MANDATE_ID!,
  request: {
    agentDid: process.env.ZANII_AGENT_DID!,
    action: 'payments.initiate',
    resource: 'account:ops-001',
    amount: { value: '250.00', currency: 'AED' },
    jurisdiction: 'AE',
    dataClass: 'confidential',
  },
} satisfies VerifyInput;

const decision = await client.verify(input, { operationId: 'invoice-INV-1042-pay' });
switch (decision.verdict) {
  case 'allow':
    break; // execute (read-only or low-risk actions); for side effects prefer the operation flow
  case 'review':
  case 'deny':
    if (decision.reasons.some((r) => r.code === REASON_CODES.APPROVAL_MISSING)) {
      // a human approves: createApproval({ mandateId, action }) with an approver key,
      // then verify again with request.approvalId and a new operation ID for the new request
    }
    for (const c of decision.conditions ?? []) if (!c.ok) console.warn(c.type, c.code);
    throw new Error(decision.reasons.map((r) => r.code).join(', '));
  default: // 'error'
    throw new Error('verification error; fail closed');
}
```

Types: `Verdict` (`verdict`, `reasons`, `mandateId?`, `agentDid?`, `evaluatedAt?`, `conditions?`,
`idempotencyReplayed?`, `offline?`, `dispatchPermit?`, plus every other server field such as
`checks` and `status`), `Reason` (`code`, `severity?`, `message?`), `ConditionResult` (`index`,
`type`, `ok`, `code?`, `reason?`, `evidence?`), `VerifyInput`, `VerifyRequest`, `Amount`,
`ReasonCode`, `BatchResult` (`results`, one per item in order).

## Errors

| Class                                     | When                                                         | Fields                                                              |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `MandateApiError`                         | Non-2xx HTTP answer                                          | `status`, `code` (server code or `HTTP_ERROR`), `detail`, `details` |
| `MandateTransportError`                   | Network failure                                              | `code: 'TRANSPORT_ERROR'`, `cause`                                  |
| `MandateTimeoutError` (extends transport) | Deadline passed                                              | `code: 'TIMEOUT'`, `timeoutMs`                                      |
| `MandateResponseError`                    | Malformed, non-object or oversized response, invalid verdict | `code: 'INVALID_RESPONSE'`                                          |

All extend `MandateError`. A missing API key throws `MandateApiError(401, 'API_KEY_REQUIRED')`
before any request. Bad arguments (operation ID outside 1 to 200 characters, batch size) throw
`TypeError`. Match on `code`, never on message text. `REASON_CODES` has all 130 codes;
`UNKNOWN_OUTCOME_CODES` is `['DATABASE_COMMIT_UNKNOWN']`.

`isUnknownOutcome(error)`: true for `MandateApiError` with `DATABASE_COMMIT_UNKNOWN`, for every
`MandateTimeoutError`, and for transport errors unless the cause chain shows the request never left
(`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`,
`UND_ERR_CONNECT_TIMEOUT`).

## Operation flow (side effects)

Operations need a PostgreSQL deployment (`OPERATIONS_REQUIRE_POSTGRES` otherwise). Bind the exact
actual arguments by digest, use one stable operation ID and one stable `expiresAt` for every retry.

```ts
import { MandateClient, isUnknownOutcome } from '@zanii/mandate-sdk';
import { canonicalize, sha256Hex } from '@zanii/mandate-core';

const client = new MandateClient({
  verifyBaseUrl: process.env.ZANII_VERIFY_URL,
  apiKey: process.env.ZANII_API_KEY,
});

async function refund(invoiceId: string, value: string) {
  const operationId = `refund-${invoiceId}`; // derived from the business key, never random per retry
  const args = { invoice: invoiceId, amount: value }; // decimal strings, no floats
  const reserved = await client.reserveOperation({
    operationId,
    mandateId: process.env.ZANII_MANDATE_ID,
    agentDid: process.env.ZANII_AGENT_DID,
    action: 'payments.refund',
    resource: `payment:${invoiceId}`,
    args,
    argsDigest: sha256Hex(canonicalize(args)),
    amount: { value, currency: 'AED' },
    count: 1,
    expiresAt: '2026-11-01T12:00:00.000Z', // stable; must not exceed the mandate expiry
    audience: 'payments-api',
    enforcementPoint: 'refund-worker-v1',
    policyRevision: process.env.ZANII_POLICY_REVISION, // must equal the server's MANDATE_POLICY_REVISION
    authorityEpoch: process.env.ZANII_AUTHORITY_EPOCH, // must equal the server's MANDATE_AUTHORITY_EPOCH
  });
  if (reserved.verdict === 'review' || reserved.state === 'held')
    return { held: reserved.reviewReasons };

  const { argsDigest, audience, enforcementPoint, policyRevision, authorityEpoch } = reserved;
  const dispatched = await client.dispatchOperation(operationId, {
    argsDigest,
    audience,
    enforcementPoint,
    policyRevision,
    authorityEpoch,
  });
  if (dispatched.idempotencyReplayed) return { replayed: dispatched }; // already ran once: do not run again
  if (dispatched.verdict !== 'allow' || dispatched.state !== 'dispatched')
    return { denied: dispatched };

  let outcome: string;
  try {
    await payments.refund(invoiceId, value); // the business action, exactly once
    outcome = 'succeeded';
  } catch {
    outcome = 'unknown';
  }

  const payload = canonicalize({ operationId, argsDigest, enforcementPoint, outcome });
  try {
    if (outcome === 'succeeded') {
      await client.commitOperation(operationId, {
        receiptHash: sha256Hex(payload), // must be sha256 of the exact payload string
        actualAmount: { value, currency: 'AED' },
        actualCount: 1,
        payload, // a string, not an object
      });
    } else {
      await client.markOperationUnknown(operationId, { payload });
    }
  } catch (error) {
    if (isUnknownOutcome(error)) {
      const state = await client.getOperation(operationId).catch(() => null); // read back, same ID
      return { reconcile: state }; // never call payments.refund again
    }
    throw error;
  }
}
```

Unlike `verify`, the operation routes **throw** a deny: `reserveOperation` and `dispatchOperation`
reject with `MandateApiError` (status 409, `code` = the first reason code, `details` = all
reasons). Only `review` comes back as a value (`state: 'held'`). Treat any thrown error before
dispatch as "do not execute".

States: `reserved`, `held` (needs approval), `dispatched`, `committed`, `unknown`, `cancelled`.
Conflicts: `OPERATION_MISMATCH` (409, same ID with different arguments or binding),
`ARGS_DIGEST_MISMATCH`, `POLICY_REVISION_MISMATCH`, `AUTHORITY_EPOCH_MISMATCH`,
`MANDATE_VERSION_MISMATCH` (pass `mandateVersionId` when the mandate has versions),
`OPERATION_EXPIRY_INVALID`, `OPERATION_STATE_INVALID`, `RECEIPT_HASH_MISMATCH`, `INVALID_OUTCOME`.
Re-sending the identical commit body to a committed operation returns the stored result; an
`unknown` operation can still be committed during reconciliation. `cancelOperation(id, { payload? })`
releases a reservation that will not run.

For a held operation, a human records an operation-bound approval with
`createApproval({ mandateId, action, operationId, argsDigest })`, and you pass its `id` in
`approvalIds` on `dispatchOperation`.

## Offline verification

```ts
const local = await client.verifyLocal({
  bundle, // zanii-offline-trust-bundle from the operator
  request: { agentDid, action: 'records.read', resource: 'record:42' },
  trustAnchors, // your own configuration, never from the bundle
  maxStatusAgeSeconds: 25,
  statusCheckpoints: [], // persist returned checkpoints and pass them back
});
// local.offline === true, local.dispatchPermit === false
```

It never falls back to the hosted API. A malformed bundle or core error is a `deny`.

A chain up to a root authority, offline (`@zanii/mandate-verify-core` 0.3.0):

```ts
import { verifyPassport } from '@zanii/mandate-verify-core';

const result = verifyPassport({
  passport, // signed by rootDid; agent = the firm's issuer DID
  passportStatusList, // the root's signed status list
  rootDid,
  mandate, // the instance's mandate
  statusList,
  delegationChain, // the firm's chain, top first: [{ mandate, statusList }, ...]
  request: { agentDid, action: 'supplier.read', resource: 'supplier:acme' },
});
// result.verdict: 'allow' | 'review' | 'deny' | 'error'; result.passport.holder is the firm's DID
```

## Caches and tracing

`keys()` and `status()` use bounded single-flight TTL/LRU caches (defaults 128 entries, 5 s).
Verdicts, credentials and usage are never cached. `forceRefresh: true` bypasses the cache. Pass an
OpenTelemetry-compatible `tracer` (`startActiveSpan` or `startSpan`); spans carry method, route,
status and operation ID only.

## Express and Fastify (repository only)

`@zanii/mandate-middleware-express` (not on npm) wraps the operation flow:
`createExpressMandateMiddleware({ client, operation })` and `createFastifyMandateHooks({ client,
operation })` (`preHandler`, `onSend`, `onError`). The `operation` mapping is server-owned:
`mandateId`, `agentDid`, `action`, `audience`, `enforcementPoint`, `policyRevision`,
`authorityEpoch` (required), `resource` or `resources` plus `resourceArgument`, `argumentSchema`
(`string`, `decimal`, `boolean`, `integer`), `amount` or `amountArgument` plus `currency`, `count`.
The request body may contain only `args`, `expiresAt`, `approvalId`, `approvalIds`; the operation ID
comes from `Idempotency-Key` or `X-Zanii-Operation-Id`. Only fresh `allow` plus `dispatched` runs
the handler; a 2xx commits, anything else marks unknown; a replay returns the stored operation with
`Idempotency-Replayed: true` and never runs the handler again.
