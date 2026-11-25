# Zanii Mandate: patterns and gotchas

## Patterns

**Gate every tool call.** Put the check in one place that every tool goes through (a wrapper, the
Express/FastAPI/Django adapters, the MCP proxy or a gateway), not in each tool. Read-only, low-risk
actions can use `verify`; anything with a side effect (payment, email, write, deploy) uses the
operation flow so usage is reserved before and committed after.

**Derive operation IDs from the business action.** `refund-INV-1042`, `ticket-8812-reply-1`. The
same action retried keeps its ID, `expiresAt` and arguments; a genuinely new action gets a new ID.
A random ID per attempt defeats replay protection and can double-count usage.

**Approval loop.**

1. `verify` returns `deny` with `APPROVAL_MISSING` (or the operation comes back `held`).
2. Show the human what is asked (`action`, resource, amount) and let an approver key or Zanii ID
   session call `createApproval({ mandateId, action })` (for an operation add `operationId` and
   `argsDigest`).
3. Retry with `request.approvalId` (verify) or `approvalIds` (dispatch). Approvals expire (within an
   hour by default), so do not cache them.

**Unknown outcome reconciliation.** On `isUnknownOutcome(error)` stop, record the operation ID, and
reconcile from your own system of record (did the refund happen?) plus `getOperation(id)`. Then
commit the real outcome with the same operation ID, or leave it unknown. Never run the business
action again to "make sure".

**Revocation.** `revoke(id, { reason, cascade: true })` ends a mandate and its children. Use
`suspend`/`reinstate` for a temporary stop. Verification denies once the signed status list
reflects it; long mandates must carry `maxStatusAgeSeconds` so a stale list fails closed.

**Least privilege first.** Start from a policy pack or the vocabulary names, add `deniedActions`
for the dangerous verbs in the same domain (`email.campaign`, `customers.export`,
`payments.update_payee`, `code.merge`), and use `approvalAbove` rather than widening limits.

**MCP agents (repository package `@zanii/mandate-mcp-proxy`).** `createMcpHttpServer(options)`
(HTTP `POST /mcp`) or `runStdioMcpProxy(options)` sit in front of an MCP server and intercept
`tools/call` before the upstream runs it. A server-owned `routes[toolName]` mapping supplies
mandate, agent, action, resources, amounts, policy revision and argument schema; the call carries
`_meta["zanii/operationId"]`, `_meta["zanii/expiresAt"]` and optional `_meta["zanii/approvalIds"]`.
Only fresh allow plus dispatched forwards the call. `createMcpProxy({ guard })` accepts an inline
guard from the Blackbox gateway package.

**Gateways (repository only).** `createAwsLambdaAuthorizer({ client, operation, route })`,
`createCloudflareWorker({ client, operation, upstream })`, the Envoy `ext_authz` service, the Kong
plugin `zanii-mandate`, the Apigee `ZaniiMandateCallout` and the Gin `Mandate(Config{...})`
middleware all use the reserve, dispatch, commit or unknown lifecycle; none treats `/v1/verify` as
permission to proxy.

## Gotchas (what models get wrong)

1. **Treating HTTP 200 as allow.** Read `verdict`. `review` is not allow; `error` fails closed.
2. **Expecting `verify` to throw on deny.** It returns the verdict. The operation routes are the
   opposite: reserve and dispatch throw `MandateApiError` (409) on deny with the reasons in
   `details`.
3. **Redoing the action after `DATABASE_COMMIT_UNKNOWN` or a timeout.** Never. Mark unknown or read
   back with the same operation ID.
4. **A new operation ID per retry.** Reuse the stable ID; only a changed request gets a new one.
   Same ID with a different body is `IDEMPOTENCY_MISMATCH` or `OPERATION_MISMATCH`.
5. **Sending `request.context`** or any field outside the allowed list. It is `400
UNSUPPORTED_FIELD`, it never changes a verdict. Condition context goes in the named top-level
   request fields (`dataSubject`, `counterpartyDid`, `dataRegion`, `destination`,
   `transferSafeguard`).
6. **Sending policy, clock or usage** (`pins`, `now`, `periodCount`, `periodAmount`,
   `delegationChain`, `statusList`, `certification`, `receiptId`, a raw `mandate`). Rejected.
7. **Numbers for money.** Amounts are decimal strings with the currency's minor units
   (`'250.00'` AED, `'1000'` JPY). Python canonical arguments reject non-integer floats.
8. **Omitting the facts the mandate restricts.** No `dataClass`, `jurisdiction` or `amount` when the
   mandate limits them gives `review` (`DATA_CLASS_UNKNOWN`, `JURISDICTION_UNKNOWN`,
   `AMOUNT_UNKNOWN`), not allow.
9. **Assuming a deny can be overridden.** `deniedActions`, `deniedResources` and
   `deniedDataClasses` win over every allow and are inherited by delegated children; approvals do
   not lift them.
10. **Rolling windows.** `maxCount` periods (`minute`, `hour`, `day`, `month`) are UTC calendar
    windows. 120 an hour resets at the top of the UTC hour.
11. **Expecting a review from `/v1/verify` for a missing approval.** The default server sets
    `requireApproval`, so it is a deny with `APPROVAL_MISSING`; the operation flow holds instead.
12. **Using a display name as the approver.** `did:zanii:role:...` approvers match only the name of
    the approving API key, which an administrator assigns. The ID token `name` claim is user-chosen
    and never satisfies a named approver; people approve roles through `group:` mappings.
13. **Thinking Zanii ID groups grant anything by themselves.** `org.groups` are labels; only
    `MANDATE_OIDC_GROUP_APPROVERS` maps them to `group:` approver roles.
14. **Gating on introspection `active`.** With Zanii ID, `active: true` only means the token is
    valid. Membership is the `org` object; Mandate requires `org.id` to equal
    `MANDATE_OIDC_ORGANIZATION_ID` (`TOKEN_NOT_MEMBER` otherwise).
15. **Treating SCIM as account provisioning.** Against Zanii ID, SCIM creates and deactivates
    organization memberships, not accounts or credentials.
16. **Assuming conditions work without providers.** A conditioned mandate with no provider loaded
    denies (`CONDITION_PROVIDER_MISSING`). Load providers through `MANDATE_CONDITION_PROVIDERS`;
    the operation flow does not pass condition context fields yet.
17. **Issuing a 30-day mandate without `maxStatusAgeSeconds`.** Over 7 days needs it, plus a
    deployment `MANDATE_MAX_VALIDITY_DAYS` that allows the length.
18. **Treating an offline allow as permission to act.** `verifyLocal` has `dispatchPermit: false`;
    quotas and approvals are not established offline.
19. **Passing an object as the commit or unknown `payload`.** It must be the exact string you
    hashed for `receiptHash` (`sha256Hex(payload)`), otherwise `INVALID_OUTCOME` or
    `RECEIPT_HASH_MISMATCH`.
20. **Guessing `policyRevision` and `authorityEpoch`.** They must equal the server's
    `MANDATE_POLICY_REVISION` (default `verify-core-v1`) and `MANDATE_AUTHORITY_EPOCH` (default
    `1`); otherwise `POLICY_REVISION_MISMATCH` / `AUTHORITY_EPOCH_MISMATCH`.
21. **Mixing package versions.** The five npm packages pin each other at 0.2.0 exactly; upgrade
    together. The middleware, gateways, MCP proxy, policy packs, bridge, Go and Java SDKs are not
    published; do not write install commands for them against a public registry.
22. **Matching messages instead of codes.** Branch on `code` (`REASON_CODES`, `codes.*`,
    `Reason*`/`Code*`, `ReasonCodes`). Codes are open strings; an unlisted one is never success.
23. **Logging secrets.** Never log API keys, bearer tokens, raw approval sessions or private request
    data. Raw API keys are shown once at creation.
