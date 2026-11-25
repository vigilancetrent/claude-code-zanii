# Zanii Mandate: concepts

## What a mandate contains

| Part                  | Meaning                                                                     | Issue field                                                         |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Grantor               | The person or company giving permission                                     | `principalDid` (optional; must equal the configured issuer)         |
| Agent                 | The agent that receives the permission                                      | `agentDid` (required)                                               |
| Actions               | Named actions such as `payments.refund`, `email.send`, `code.deploy`        | `actions` (required, at least one)                                  |
| Resources             | Which accounts, customers, folders, systems or data                         | `resources` (required, `*` wildcards allowed)                       |
| Limits                | Amount, count per period, country, data class, time window                  | `constraints`                                                       |
| Deny rules            | Never allowed, even if something else allows it                             | `constraints.deniedActions`, `deniedResources`, `deniedDataClasses` |
| Human approval        | A person approves above a limit or for a named action                       | `constraints.approvalAbove`, `requiredApprovals`                    |
| Conditions            | External checks such as consent or counterparty screening                   | `constraints.conditions`                                            |
| Expiry and revocation | Ends on its own; revocation takes effect within the status freshness budget | `expiresAt`, `maxStatusAgeSeconds`                                  |
| Re-delegation         | Whether the agent may pass a smaller part on                                | `delegation`, `parentMandateId`                                     |

Other issue fields: `agentName`, `agentVersion`, `agentOperator`, `principalType`,
`principalLegalName`, `principalJurisdiction`, `certification` (`required`, `minLevel` L1 to L3,
`scope`) and `evidence` (`receiptRequired`, `minConfidence`). Certification and receipts are checked
only from server-side state; a mandate that requires what the server cannot establish fails closed
(`CERTIFICATION_UNVERIFIED`, `EVIDENCE_MISSING`).

The signed credential keeps limits under `credentialSubject.constraints` and the freshness budget
under `credentialSubject.revocation.maxStatusAgeSeconds`; you send the flat issue body and the
server builds, validates and signs it.

## Verdicts and reasons

`verdict` is `allow`, `deny`, `review` or `error`; `reasons[]` has `code`, `severity` (`hard` gives
deny, `soft` gives review, `error` gives error) and `message`; `checks[]` lists every check. `allow`
is returned only when every check passes; soft failures never authorize. The shared list of 130 codes
is `tests/fixtures/reason-codes.json`; all four SDKs expose it (TS `REASON_CODES`, Python
`zanii_mandate.codes`, Go `Reason*`/`Code*`, Java `ReasonCodes`). `UNKNOWN_OUTCOME_CODES` contains
only `DATABASE_COMMIT_UNKNOWN`.

## Constraints

| Field                                                     | Shape                                                                                                                         | Effect and codes                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `maxAmount`                                               | `{ value: '2500.00', currency: 'AED', period?: 'transaction' \| 'day' \| 'month' }`                                           | `AMOUNT_LIMIT_EXCEEDED`, `CURRENCY_MISMATCH`, `AMOUNT_UNKNOWN` (no amount sent), `PERIOD_AMOUNT_UNKNOWN`              |
| `maxCount`                                                | `{ value: 50, period?: 'minute' \| 'hour' \| 'day' \| 'month' }` (default `day`)                                              | UTC calendar windows counted by the server, not rolling. `COUNT_LIMIT_EXCEEDED`, `PERIOD_COUNT_UNKNOWN`               |
| `allowedJurisdictions`                                    | `['AE']`                                                                                                                      | `JURISDICTION_NOT_ALLOWED` (deny), `JURISDICTION_UNKNOWN` (review when not sent)                                      |
| `allowedDataClasses`                                      | `['public', 'confidential']`                                                                                                  | `DATA_CLASS_NOT_ALLOWED` (deny), `DATA_CLASS_UNKNOWN` (review when not sent)                                          |
| `deniedActions` / `deniedResources` / `deniedDataClasses` | arrays (resources take `*` patterns)                                                                                          | Always a hard deny, even when `actions`/`resources` allow it: `ACTION_DENIED`, `RESOURCE_DENIED`, `DATA_CLASS_DENIED` |
| `timeWindow`                                              | `{ timezone: 'Asia/Dubai', days: ['Mon', ...], hours: '09:00-17:00' }`                                                        | `OUTSIDE_TIME_WINDOW`                                                                                                 |
| `requiredApprovals`                                       | `[{ action, approver?, threshold?, count? (1 to 10), minAcr? ('pwd' \| 'mfa' \| 'hwk') }]`                                    | `APPROVAL_*`, `SEPARATION_OF_DUTIES`                                                                                  |
| `approvalAbove`                                           | `{ amount?, count?, riskTier?, approvals? (1 to 10), approver?, minAcr? }`; set at least one of `amount`, `count`, `riskTier` | Above any limit the action needs approval; an unknown amount, count or vocabulary tier counts as above                |
| `conditions`                                              | `[{ type, params? }]`, 1 to 20                                                                                                | Checked by providers, see below                                                                                       |

Amounts are decimal strings matching the currency's minor units (0, 2 or 3 decimals). An
`approvalAbove.count.period` must match `maxCount.period`. `approvalAbove.riskTier` triggers for
actions whose vocabulary tier ranks above the given tier, and for free action names (no tier).

## Approvals

- `POST /v1/approvals` (scope `approvals:create`, body `mandateId`, `action`, optional `expiresAt`,
  and for an operation `operationId` plus `argsDigest`). The approver identity is the API key name
  (or the Zanii ID session), never the body. The key that issued the mandate cannot approve it.
  Reject and cancel: `POST /v1/approvals/{id}/reject`, `/cancel`.
- The caller then retries with `approvalId` (or `approvalIds`, at most 10, for multi-person rules).
- The default server configuration sets `requireApproval: true`, so on `POST /v1/verify` a missing
  approval is a **deny** (`APPROVAL_MISSING`). The operation flow holds the action instead
  (`state: 'held'`, `verdict: 'review'`, `reviewReasons`).
- Named approvers `did:zanii:role:...` match only the **name of the approving API key**, which an
  administrator assigns. A display name never satisfies a named approver. Approvers starting with
  `group:` are satisfied only by an approval that recorded that role from a Zanii ID group mapping.
- Approving a `minAcr` requirement needs a human session at that assurance level (403
  `APPROVAL_STEP_UP_REQUIRED` otherwise). Too few distinct approvers gives
  `APPROVAL_DISTINCT_PEOPLE_REQUIRED`.

## Conditions and condition providers

Providers are opt-in. The verify service loads them at startup from `MANDATE_CONDITION_PROVIDERS`
(comma-separated module specifiers, each exporting `createConditionProviders(config)` that returns
`{ [type]: async ({ mandate, request, condition, now }) => ({ ok, reason?, evidence? }) }`). A load
error or a duplicate type stops startup. Timeout: `MANDATE_CONDITION_TIMEOUT_MS` (default 2000).

Every outcome other than `ok: true` denies:

| Situation                                                | Code                         |
| -------------------------------------------------------- | ---------------------------- |
| No provider registered for the type                      | `CONDITION_PROVIDER_MISSING` |
| Provider answered `ok: false`                            | `CONDITION_NOT_MET`          |
| Provider threw, timed out or returned a malformed result | `CONDITION_ERROR`            |

Providers run only after schema and signature checks pass. Verdicts carry `conditions[]` with
`index`, `type`, `ok`, `code`, `reason`, `evidence`. Request context for providers: `dataSubject`,
`counterpartyDid`, `dataRegion`, `destination`, `transferSafeguard` (strings, at most 512
characters); they never widen an allow on their own. The operation flow does not pass these context
fields yet, so conditions that need them are a `/v1/verify` feature today.

The five Zanii providers live in the repository package `@zanii/mandate-zanii-bridge`
(`createConditionProviders(config)`, config keys `jurisdiction`, `kyb`, `consent`, `kya`,
`residency`; not published, and it imports published `@zanii/*` packages on first use). Since the
verify service passes its own configuration, point `MANDATE_CONDITION_PROVIDERS` at a small module of
yours that calls the bridge's `createConditionProviders` with these keys.

| Type                    | Params                                                                                         | Request field                                                  | Config key                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `jurisdiction.bound`    | `regulator`, `jurisdiction`, `sector` (at least one), `subject`: `agent`, `principal` or `any` | none                                                           | `jurisdiction: { bindings, regulators, delegations?, acceptSelfDeclared?, allowUnknownCodes? }` |
| `kyb.verified`          | `domain?`, `entity?`                                                                           | none                                                           | `kyb: { attestations, ownerDoc(domain) }`                                                       |
| `consent.active`        | `purpose`, `scope?`, `subjectCommitment?`                                                      | `dataSubject` (a `sha256:` commitment, never a raw identifier) | `consent: { records }`                                                                          |
| `counterparty.screened` | `counterparty?`                                                                                | `counterpartyDid`                                              | `kya: { denyList?, provider?, owner?(did), screenedBy? }`                                       |
| `residency.within`      | `allowedRegions` or `preset`, and/or `from`                                                    | `dataRegion`, `destination`, `transferSafeguard?`              | `residency: { rules? }`                                                                         |

Values signed into `params` win; a request value that disagrees is refused. Missing configuration
fails closed.

## Delegation

- Issue a child with `parentMandateId`. The parent must be active, have `delegation.allowed` and depth
  left (`maxDepth` 0 to 10); `allowedActions` and `allowedSubjects` narrow what children may get.
- The child must be a subset of the parent (actions, resources, amounts and periods, counts and
  periods, jurisdictions, data classes, time window, approvals, certification, evidence, expiry).
- Every restriction is inherited: a child must cover each parent deny, keep each parent condition,
  keep an `approvalAbove` at least as strict, keep the same count period, and keep a freshness budget
  no weaker than the parent's. Codes: `DELEGATION_INVALID`, `DELEGATION_TOO_DEEP`,
  `DELEGATION_CYCLE`, `DELEGATION_PARENT_MISSING`, `DELEGATION_CHAIN_MISSING`.
- Revoking a parent cascades by default (`POST /v1/mandates/{id}/revoke` body `{ reason?, cascade? }`,
  `cascade` default true; the response has `affectedChildren`).
- Budgets are shared upwards: every parent with a `maxCount` or `maxAmount` counts its children's use,
  on `POST /v1/verify` and on reserve/dispatch alike (servers from 1 November 2026). Siblings draw on the
  parent's budget together.

## Root passports (a firm under a root authority)

- A root authority (for example a free zone) issues one **passport**: an ordinary mandate whose agent is
  the firm's Mandate issuer DID, with `delegation.allowed`. The firm then issues its own tree (company,
  role, release, instance) under its issuer key, so the root never signs anything else.
- `verifyPassport` (`@zanii/mandate-verify-core` 0.3.0) checks, offline: the passport is a root signed by
  `rootDid`, names the chain's issuer, allows delegation, is not revoked or expired in the root's status
  list, covers the request, and the firm's top mandate stays within it; then the firm's chain to the
  instance. Revoking any level denies everything below it. Codes: `PASSPORT_ROOT_UNTRUSTED`,
  `PASSPORT_NOT_ROOT`, `PASSPORT_ISSUER_MISMATCH`, `PASSPORT_NOT_DELEGABLE`, `PASSPORT_SCOPE_EXCEEDED`,
  plus the usual mandate codes with `scope: 'passport'` for the passport's own.
- Budgets on a passport cannot be counted offline, so they give `review`, never `allow`.

## Validity, revocation and status freshness

- Default maximum validity is **7 days**. Longer needs `maxStatusAgeSeconds` (1 to 3600) at issue,
  which makes live status checks mandatory, and the deployment maximum `MANDATE_MAX_VALIDITY_DAYS`
  (default 7, 1 to 365). Otherwise `VALIDITY_EXCEEDS_POLICY` / `MANDATE_VALIDITY_EXCEEDED`.
- Revocation and suspension flip a bit in a signed status list (`GET /v1/status/{listId}`, public,
  default list `mandates`). The verifier requires fresh signed status: missing or stale status fails
  closed (`STATUS_MISSING`, `STATUS_STALE`; no published envelope at all is a 503
  `STATUS_UNAVAILABLE`). The server budget is
  `REVOCATION_SLO_SECONDS` (default 30) minus `STATUS_FETCH_ENFORCEMENT_BUDGET_SECONDS` (default 5).
- `suspend` is reversible with `reinstate`; `revoke` is final (reinstating a revoked mandate is 409).

## Offline verification

`MandateClient.verifyLocal({ bundle, request, trustAnchors, maxStatusAgeSeconds, statusCheckpoints,
now })` (TypeScript only) calls `verifyOfflineTrustBundle` from `@zanii/mandate-verify-core`. It
never calls the hosted API.

- `bundle` is a `zanii-offline-trust-bundle` (version 1) produced by the operator with
  `createOfflineTrustBundle` in the repository's `packages/db`; there is no HTTP route for it.
- `trustAnchors` is caller configuration (`[{ issuerDid, keys: [{ purpose: 'mandate' | 'status',
verificationMethod, publicKey, activatedAt, retiredAt, compromisedAt }] }]`), never taken from the
  bundle. Keys copied from `bundle.issuerKeys` do not establish trust.
- Status must be fresh within `maxStatusAgeSeconds`, or the result denies. Persist returned
  checkpoints (`issuer`, `listId`, `version`, `hash`) and pass them as `statusCheckpoints`; an older
  snapshot denies with `STATUS_ROLLBACK`, different bytes at one version with `STATUS_EQUIVOCATION`.
- Every result has `offline: true` and `dispatchPermit: false`. Count quotas, day/month amount
  quotas and required approvals add `DYNAMIC_STATE_UNAVAILABLE` and prevent `allow` (usually
  `review`). An offline allow is not a reservation, approval or spend.

## Shared action vocabulary

`ACTION_VOCABULARY` in `@zanii/mandate-core`: 56 `<domain>.<verb>` actions, each with `label`,
`riskTier` (`low`, `medium`, `high`, `critical`) and `resourceType`. Prefixes: `payments`, `email`,
`messages`, `customers`, `records`, `health`, `government`, `contract`, `code`, `secrets`, `travel`,
`hr`, `calendar`, `agents`. Look up with `describeAction(name)` / `actionRiskTier(name)` (free names
return `null`). Free action names still work; they just have no tier, so `approvalAbove.riskTier`
treats them as above the limit. `LEGACY_ACTION_ALIASES` maps 1.0.0 names (`payment.initiate` to
`payments.initiate`, `permit.read` to `government.read`, and so on).

Examples: `payments.initiate` high, `payments.approve` critical, `payments.update_payee` critical,
`email.send` medium, `email.campaign` high, `customers.export` critical, `records.share` high,
`health.prescribe` critical, `contract.sign` critical, `code.deploy` high, `secrets.read` critical,
`hr.payroll` critical, `calendar.book` low, `agents.pay` high.

## Policy packs (repository package `policy-packs`)

Ready-made templates; data, never code; they can only narrow. Install over HTTP with
`POST /v1/templates/packs/{packId}/install` (scope `templates:write`). Exports: `POLICY_PACKS`,
`LEGACY_POLICY_PACKS`, `getPolicyPack(id, version?)`, `packDefinition(pack)`, signed catalogs
(`createCatalog`, `signCatalog`, `verifyCatalog`, `applyCatalog`).

| Pack             | Version | Agent may                                            | Main limits                                                           | Never                                                          | Needs a human                                                    |
| ---------------- | ------- | ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `banking`        | 1.1.0   | Read accounts, start payments                        | 2,500 AED per payment, 50 a day, AE only                              | Approve payments, change payee details, identity-document data | Over 1,000 AED (`did:zanii:role:treasury-approver`)              |
| `government`     | 1.1.0   | Read and draft permits, submit filings               | 200 a day, AE, public documents, Mon to Fri 08:00 to 17:00 Asia/Dubai | Cancel or withdraw a filing                                    | Above medium risk (every submission)                             |
| `healthcare`     | 1.1.0   | Read patient records, book appointments              | 100 a day, AE, confidential                                           | Prescribe, export customers, share records                     | None                                                             |
| `communication`  | 1.0.0   | Read, draft, send support email                      | 200 a day                                                             | Campaigns, external recipients, marketing or health data       | None                                                             |
| `customer-data`  | 1.0.0   | Read UAE customer profiles                           | 120 an hour, AE                                                       | Export or delete customers, share records, card or health data | None                                                             |
| `legal`          | 1.0.0   | Read, draft, send, sign contracts                    | 40 a day                                                              | Nothing beyond the action list                                 | Above medium risk: one legal manager with MFA; signing needs two |
| `engineering`    | 1.0.0   | Read, write, review code, deploy to staging          | 10 an hour                                                            | Secrets, protected merges, production                          | None (production is denied)                                      |
| `travel`         | 1.0.0   | Search, book, cancel economy travel                  | 3,000 AED per booking, 10 a day                                       | Business and first class                                       | Over 1,500 AED                                                   |
| `hr`             | 1.0.0   | Screen candidates, book interviews, recruiting email | 60 a day, Mon to Fri 08:00 to 18:00 Asia/Dubai                        | Offers, payroll, terminations, record changes                  | None                                                             |
| `agent-to-agent` | 1.0.0   | Find, hire, pay, delegate to a translation agent     | 200 AED per payment, 3 a day                                          | Any service other than `service:translation`                   | Payments over 100 AED                                            |

## Zanii ID integration (repository package `id-adapter`)

- OIDC sign-in is off unless `MANDATE_OIDC_ENABLED=1` (PostgreSQL required).
- **Directory groups as approvers.** Zanii ID puts an organization's directory groups on the `org`
  claim as `groups`. In Zanii ID they are labels that **grant nothing**; Mandate gives them meaning
  only through `MANDATE_OIDC_GROUP_APPROVERS`, a JSON map from group name to roles that must start
  with `group:`, for example `{"Treasury approvers":["group:treasury-approvers"]}`. Groups come only
  from the verified ID token, never from userinfo, an API key or a body. The person still needs
  Mandate's `approver` membership role, separation of duties still applies, and roles are a snapshot
  at approval time. Zanii ID organization roles (`org.role`) grant nothing beyond the optional
  approval floor `MANDATE_OIDC_APPROVAL_MIN_ORG_ROLE` (`member` default, or `admin`).
- **Introspection gates on `org`, not on `active`.** With `MANDATE_OIDC_INTROSPECTION=1` (needs
  `MANDATE_OIDC_ORGANIZATION_ID`), `active: true` means only a valid unexpired token; Mandate also
  requires `org.id` equal to the configured organization. No `org` or another organization is
  `TOKEN_NOT_MEMBER` (403). High-risk actions (tier from `MANDATE_OIDC_INTROSPECTION_MIN_RISK_TIER`,
  default `high`; untiered actions count as above) need the caller's Zanii ID access token in
  `X-Zanii-Id-Token` beside the API key, on `/v1/verify`, `/v1/verify/batch`,
  `/v1/operations/reserve` and `/v1/operations/{id}/dispatch`. Missing is `IDENTITY_TOKEN_REQUIRED`,
  inactive is `TOKEN_INACTIVE`, issuer unreachable is `INTROSPECTION_UNAVAILABLE` (503). While it is
  on, an API key cannot approve. Include `offline_access` and `organization` in `MANDATE_OIDC_SCOPES`.
- **SCIM manages memberships, not accounts.** A SCIM create or deactivate against Zanii ID changes
  organization membership (and Mandate's local roles and sessions that depend on it); it never
  creates sign-in credentials. A user without the `subject` extension has not accepted the
  invitation and cannot act. Identity lifecycle events do not revoke mandates.
