---
name: zanii
description: >-
  Build, instrument, or audit AI agents with Zanii: verifiable did:key identity,
  scoped delegation and revocation, signed hash-chained proof-of-action receipts,
  offline verification (including payload checks and paged exports), durable
  receipt journals, typed error codes, the deterministic runtime, and the MCP proxy. Use
  this whenever a task involves agent accountability, a tamper-proof record of what
  an AI agent did, "prove who did what", or the @zanii/* (npm) or zanii (Python)
  SDKs, or the ledger.zanii.agency API.
---

# Zanii: verifiable identity & proof-of-action for AI agents

Zanii gives every AI agent a cryptographic identity and turns each action into a
signed, hash-chained **receipt** in an append-only Merkle transparency log,
anchored on-chain. Anyone can verify *who did what, under whose authority*,
**offline, without trusting the server**. The ledger stores only a hash of each
payload, so business data never leaves the caller's systems.

Written for **`@zanii/sdk` 0.6.0 or later** (`@zanii/runtime` 0.4.0, `@zanii/cli` 0.3.0) and
**`zanii` 0.27.0 or later** (PyPI), released 2026-10-29 — but the **Regulator Hub** modules
below need **`zanii` 0.28.0**, so `pip install "zanii>=0.28"` if a task touches those; threat signatures in
`zanii.status_feed` need **0.29.0**, and role CVs and league tables in `zanii.cv` need **0.31.0**. Install
`npm i @zanii/sdk@^0.6.0` and `pip install "zanii>=0.27"`: under 0.x semver an existing `^0.5.x`
range never picks up 0.6.

## Which package to use

| Need | npm | Python |
|---|---|---|
| Pure protocol + **verify** offline (no I/O) | `@zanii/core` | `zanii.core` |
| **Instrument an agent** (identity, delegation, record, verify) — start here | `@zanii/sdk` | `zanii` |
| **Deterministic rails** (propose→gate→record; enforce authority/status/human-gate) | `@zanii/runtime` | `zanii.runtime` |
| **Receipt every MCP tool call**, zero agent changes — and, opt-in, the server's sampling/elicitation/roots requests back to the client | `@zanii/mcp-proxy` | `zanii.mcp_proxy` (`zanii[mcp]`) |
| **Instrument framework tools** in one line (Vercel AI SDK / any Python tools) | `@zanii/ai` | `zanii.ai` |
| **Receive + verify webhooks** (`X-Zanii-Signature`) | `@zanii/webhooks` | `zanii.webhooks` |
| **Test agents offline** (in-memory ledger + fixtures) | `@zanii/testing` | `zanii.testing` |
| **Independently monitor** a log (append-only + anchors) | `@zanii/monitor` | `zanii.monitor` (`zanii-monitor` CLI) |
| **Trust UI** — client-side verifying React components | `@zanii/react` | *(JS only)* |

More optional packages, all **published** (the npm registry has the per-package versions).
Each one also ships in Python as `zanii.<name>` (`zanii` 0.28.0 for the Regulator Hub modules below, 0.29.0 for threat signatures, 0.31.0 for role CVs, 0.27.0 for the rest; same bytes as TypeScript wherever it
signs or hashes); see `reference/ecosystem.md` for signatures:

| Need | npm |
|---|---|
| **CLI** — identities/delegation/verify/export from the terminal | `@zanii/cli` |
| **Proxy** any HTTP API so every call is receipted | `@zanii/gateway` |
| **Compliance report** from an audit bundle | `@zanii/compliance` |
| **Seal keys at rest** (scrypt + AES-256-GCM) | `@zanii/kms` |
| **Keep the key out of the agent process** — sign through a local daemon (`DaemonAgent`); the daemon can itself sign through an HSM/KMS | `@zanii/signerd` |
| **Check an implementation** against the protocol vectors | `@zanii/conformance` |
| **Stop attacks before they land** — inline guard, agent-change tracking, red-team harness | `@zanii/guard` |
| **Privacy proofs — committed totals, "value >= t", set membership** | `@zanii/zk` |
| **Embodied AI — safety envelopes, device-signed telemetry, black box** | `@zanii/robotics` |
| **Grid actions — metering, demand-response delivery, renewable claims** | `@zanii/energy` |
| **Agent trading — pre-trade checks, best execution, order trails** | `@zanii/trading` |
| **Election operations — custody and tabulation (never votes)** | `@zanii/elections` |
| **AI in learning — use declarations, grade trails** | `@zanii/education` |
| **AI legal work — citation checks, lawyer sign-off, privilege** | `@zanii/legal-ai` |
| **Supervisors — scoped feeds, random samples, incident clocks** | `@zanii/regulator` |
| **Which regulator, jurisdiction and sector an agent is under** (signed bindings, "which agents are mine?") | `@zanii/jurisdiction` |
| **Serious-incident reports** from ledger evidence (EU AI Act Art. 73 draft template, OECD) | `@zanii/incident-report` |
| **Post-market monitoring + log retention evidence** (EU AI Act Art. 72) | `@zanii/post-market` |
| **AI system register entries** (EU AI Act Annex VIII, UK ATRS, Eurocities) | `@zanii/ai-register` |
| **Signed status feed per jurisdiction** (revocations, certificate status, incidents; Atom / JSON Feed) | `@zanii/status-feed` |
| **AI emissions — per-call footprint, period reports** | `@zanii/carbon` |
| **Agent treasury — spending policy, balanced journal, reconciliation** | `@zanii/agent-bank` |
| **Co-sign** a log as an independent witness | `@zanii/witness` |
| **Pre-action policy** (amount caps, allow-lists, rate limits) | `@zanii/policy` |
| **OpenTelemetry spans** for every action | `@zanii/otel` |
| **Correct money** for payment receipts (bigint minor units) | `@zanii/payments` |
| **"Verified by Zanii" badges** for any site | `@zanii/embed` |
| **OpenAI/Anthropic tool-call** proof recording | `@zanii/connectors` |
| **LangChain / LangGraph** — receipt a whole run | `@zanii/langchain` |
| **OpenAI Agents SDK** — receipt via RunHooks | `@zanii/openai-agents` |
| **CrewAI** (Python-only) — `zanii[crewai]` | *(zanii.crewai)* |
| **GDPR deletion attestations** (+ the inverse: proof records were *kept*) | `@zanii/retention` |
| **Selective disclosure** (prove one field, hide the rest) | `@zanii/redact` |
| **A2A discovery** — resolve a DID to its verified history | `@zanii/a2a-directory` |
| **Verify a payment's on-chain settlement** (x402/AP2) | `@zanii/x402` |
| **ERC-8004 identity** — register/resolve agents on-chain | `@zanii/erc8004` |
| **PDPL consent receipts** (grant/withdrawal) | `@zanii/consent` |
| **Court-ready evidence pack** (bilingual AR/EN, UAE 46/2021) | `@zanii/admissibility` |
| **FTA filing evidence** — "prepares, never files" + Tax-Agent handoff | `@zanii/fta` |
| **Vertical walls** — SCA trading/RERA/TDRA/Legal/Consumer + DIFC/ADGM | `@zanii/walls` |
| **Provable agent memory** — hash-chained "why did it decide that?" | `@zanii/memory` |
| **Know Your Agent** — screen a counterparty before transacting | `@zanii/kya` |
| **Which code ran** — bind a TEE/runtime attestation to a receipt | `@zanii/attest` |
| **N-party (3+) co-signed receipts** — swarm teams (`POST /v1/swarm`, SPEC §14) | `@zanii/swarm` |
| **Per-subject auditability** — end users verify their own slice (`/v1/subjects/{tag}`) | `@zanii/subject` |
| **Custody verdicts** — the one verifier: five computed (never stored) verdict rows; `zanii audit` + subject page share it | `@zanii/custody-verdicts` |
| **Content credentials** — "made by a known, accountable agent" (anti-deepfake) | `@zanii/provenance` |
| **Supply-chain custody** — co-signed handoff chains for physical goods | `@zanii/custody` |
| **Auditable algorithmic decisions** — completeness + rule-consistency + committed factors | `@zanii/decisions` |
| **Behavioral monitoring** — drift detection, "antivirus for agents" | `@zanii/sentinel` |
| **Verifiable credentials** — diplomas/licences, domain-bound issuer root-of-trust | `@zanii/credentials` |
| **Public-sector accountability** — state decisions + citizen appeal pack | `@zanii/gov` |
| **Medical audit trails** — per-episode *unlinkable* tags; break-glass is loud, not impossible | `@zanii/health` |
| **AgentCV** — a signed, portable view over the ledger (un-inflatable summary) | `@zanii/cv` |
| **Escrow** — conditional payments; release on a Merkle-proven receipt (never held funds) | `@zanii/escrow` |
| **Insurance** — underwriting risk FACTS (never a score) + deterministic claims | `@zanii/insurance` |
| **Federation** — witness policies, split-view gossip, the equivocation proof | `@zanii/federation` |
| **Succession** — key rotation with signed continuity; compromise brackets the trusted window | `@zanii/succession` |
| **SLA** — co-signed service terms; compliance computed from receipts, chain-proven complete | `@zanii/sla` |
| **Constitution** — the agent's rules as signed policy; provable governance via `manifest_hash` | `@zanii/constitution` |
| **Post-quantum** — hybrid Ed25519+ML-DSA dual-signing + anchored transition records | `@zanii/pq` |
| **Credential broker** — the agent never holds raw keys; receipt-or-nothing injection, fail-closed | `@zanii/broker` |
| **W3C VC bridge** — genuine eddsa-jcs-2022 DataIntegrityProofs; verify anyone's did:key VC | `@zanii/vc` |
| **KYB** — two-way owner↔domain legal-entity binding (who is legally on the hook) | `@zanii/kyb` |
| **Zanii L1 bridge** — one keypair is both a `zan1…` wallet and a ledger DID; prove the binding | `@zanii/chain-bridge` |
| **Training provenance** — training-set manifests + offline subject-absence proofs | `@zanii/train` |
| **Identity bridge** — bind an Entra/SPIFFE agent identity to a did:key (two-way, injected verifier) | `@zanii/identity-bridge` |
| **Data custody** — prove what happened to a user's DATA; purpose enforced by the ledger | `@zanii/data-custody` |
| **Residency** — "did my data leave the country?"; region-bound touches + border crossings | `@zanii/residency` |
| **Subprocessor** — provable onward-transfer graph; undeclared-party detection (GDPR Art. 28) | `@zanii/subprocessor` |
| **Minimization** — declared-minimum field-set proofs (GDPR Art. 5(1)(c)) | `@zanii/minimization` |
| **Age assurance** — prove the age gate happened without storing the ID | `@zanii/age-assurance` |

Install: `npm i @zanii/sdk@^0.6.0` or `pip install "zanii>=0.27"`. Everything above is published; the
stable core is `@zanii/{core,sdk,runtime,mcp-proxy}` + `zanii` (PyPI), and the rest are optional
add-ons (npm packages, and Python modules inside `zanii` with extras like `zanii[langchain]`).
Server: `https://ledger.zanii.agency` (supports paged exports, `GET /v1/export/{did}?limit=&offset=&size=`).

## What to use when (0.6.0 / 0.27.0)

| Task | TypeScript (`@zanii/sdk`) | Python (`zanii`) |
|---|---|---|
| Revoke a leaked key / delegation | `createRevocation(cert, ts, ownerKey)` + `submitRevocation(server, rev, { apiKey })`, then `checkRevocation` | `create_revocation` + `submit_revocation(..., api_key=)`, `check_revocation`; CLI `zanii revoke ... --submit` |
| Check a proof including its payload | `fetchAndVerifyProof(server, hashOrVerifyUrl, fetch, { payload, nonce })`, read `payload.status` | `fetch_and_verify_proof(server, hash, payload=, nonce=)` |
| Know the log accepted THIS receipt | `recordAndConfirm(fields, { timeoutMs })` | `record_and_confirm(target, payload)` |
| Never lose receipts at scope or process exit | `await using agent = new ZaniiAgent(...)`, `close({ flush: true })`, `flushOnExit: true` | `with ZaniiAgent(...)`, `flush_on_exit=True`, `flush_interval=` |
| Survive restarts on one host | `FileReceiptJournal` (`@zanii/sdk/durable`) + `recordDurably` / `recoverPendingReceipts` | `zanii.durable.FileReceiptJournal` |
| Survive restarts and multiple hosts | `SqlReceiptJournal` (`@zanii/sdk/sql-journal`, Postgres or SQLite) | `zanii.sql_journal.SqlReceiptJournal` |
| Prove a custom journal is safe | `runJournalConformance` (`@zanii/sdk/journal-testkit`) | `zanii.journal_testkit.run_journal_conformance` |
| Async Python servers | (not needed: TS is async) | `zanii.aio.AsyncZaniiAgent` (`async with`, coroutine `record`/`flush`) |
| Tune retries, alert on delivery | `retry: { maxAttempts, baseMs, capMs, jitter }`, `onDelivered` / `onRetrying` / `onFailed` | `retry={...}`, `on_delivered` / `on_retrying` / `on_failed` |
| Verify a huge export | `fetchAndVerifyBundlePaged(server, did, fetch, { pageSize, onPage })` | `fetch_and_verify_bundle_paged(server, did, page_size=)` |
| Full bundle with proof details, settlement, witness | `fetchAndVerifyBundle` | `fetch_and_verify_bundle` |
| Handle errors by code | `isZaniiError(e, 'QUEUE_FULL')`, `ZaniiHttpError` (`status`, `serverCode`), `ZANII_ERROR_CODES` | `zanii.errors.is_zanii_error`, `ZaniiHttpError` (`status`, `server_code`) |
| Cross-org A2A | `a2aDraft` / `a2aAccept` / `a2aFinalize` / `submitInteraction` | the same on `ZaniiAgent`: `a2a_draft` / `a2a_accept` / `a2a_finalize` / `submit_interaction` |
| Which SDK is installed | `npm ls @zanii/sdk` | `zanii.__version__` |

Recipes: `reference/typescript.md`, `reference/python.md`; patterns: `reference/patterns.md`.

## The core workflow (memorize this)

1. **Identity**: `generateKeypair()` → an Ed25519 `did:key`. The DID *is* the public key (no lookup to verify).
2. **Delegation**: the owner signs a scoped, expiring cert granting the agent authority (revocable on the log).
3. **Instrument**: create a `ZaniiAgent`, then `wrapTool(name, fn)` (every call receipted) or `record({target, payload})`.
4. **Verify**: `fetchAndVerifyProof(server, hash)` or `verifyAuditBundle(bundle)`, offline, zero trust.

**TypeScript:**
```ts
import { ZaniiAgent, generateKeypair, createCert, fetchAndVerifyProof } from '@zanii/sdk';

const owner = generateKeypair();
const agent = generateKeypair();
const cert = createCert(
  { issuer: owner.did, subject: agent.did, scopes: ['crm.*'], exp: '2027-01-01T00:00:00Z' },
  owner.privateKey,
);
const zanii = new ZaniiAgent({
  serverUrl: 'https://ledger.zanii.agency',
  agentDid: agent.did, agentPrivateKey: agent.privateKey,
  delegation: [cert], apiKey: process.env.ZANII_API_KEY,
});
const lookup = zanii.wrapTool('crm.lookup', (email: string) => crm.find(email)); // every call receipted
const { hash, nonce } = await zanii.record({ target: 'crm.lookup', payload: { email: 'a@b.co' } });
await zanii.close({ flush: true });                       // or `await using zanii = ...` (Node 24+)
const proof = await fetchAndVerifyProof('https://ledger.zanii.agency', hash, fetch,
  { payload: { email: 'a@b.co' }, nonce });              // also checks the receipt commits to this payload
if (!proof.ok) throw new Error(proof.checks.filter((c) => !c.ok).map((c) => c.label).join('; '));
```

**Python:**
```python
from zanii import ZaniiAgent, fetch_and_verify_proof
from zanii.core import generate_keypair, create_cert

owner, agent = generate_keypair(), generate_keypair()
cert = create_cert(issuer=owner.did, subject=agent.did, scopes=["crm.*"],
                   exp="2027-01-01T00:00:00Z", issuer_private_key=owner.private_key)
with ZaniiAgent(server_url="https://ledger.zanii.agency", agent_did=agent.did,
                agent_private_key=agent.private_key, delegation=[cert], api_key=API_KEY,
                nonce_store={}) as zanii:        # flushes and closes at block exit
    receipt, h = zanii.record(target="crm.lookup", payload={"email": "a@b.co"})
assert fetch_and_verify_proof("https://ledger.zanii.agency", h,
                              payload={"email": "a@b.co"}, nonce=zanii.nonce_store[h]).ok
```

## Accountability features (know these)

- **`record()` salts the payload by default** now: `payload_hash = sha256(nonce ‖ payload)`, so two
  identical payloads differ on the log (privacy/PDPL). It returns/stores a `nonce` — pass a `nonceStore`
  (or keep the returned `nonce`) if you need to *prove* a payload later with `verifyPayload(payload, nonce, hash)`.
  Opt out with `record({ …, salt: false })` for a deterministic hash. Receipt validity is unchanged.
- **Owner-signed confirmations** (Article VI): `new Runtime(agent, { …, ownerDid })` makes `confirm()`
  require a valid `ActionConfirmation`. `propose()` returns `actionHash`; the owner signs it with
  `createConfirmation({ ownerId, actionHash, confirmedAt }, ownerKey)`; pass it to `confirm(cid, conf)`.
  It's recorded as an `action_confirmation` receipt — evidence a human approved.
- **Provenance + compliance anchoring**: `record({ …, provenance: { runtimeHash, modelId, manifestHash } })`
  or `new Runtime(agent, { manifestHash, runtimeHash, modelId, intentReceipts: true })` — stamps which
  rulebook governed each action; `intentReceipts` emits an `action_intent` before the tool runs (omission-evidence).
- **Keys in an HSM or KMS** (`@zanii/sdk` 0.5.4+, `zanii` 0.25.4+): `new ZaniiAgent({ …, signer })` with any
  `{ publicKey, sign(message) → 64-byte Ed25519 sig }` (a `@zanii/kms` `RemoteSigner` fits). Receipts still chain
  in call order; a failed signature rejects that `record()` and records nothing. For A2A finish with
  `a2aFinalizeAsync`. Same hook in `@zanii/signerd` (`signer`), `@zanii/witness` (`createRemoteWitness`).
- **Segregation of duties**: `createCoSignature`/`verifyCoSignature` (an infra key co-signs a receipt; the
  co-signer must differ from the agent) + `reconcile(ledgerRefs, providerRefs)` in `@zanii/compliance`
  (surfaces unreported actions). SPEC §12 (confirmations), §13 (co-sign).

## Rules you MUST follow when writing Zanii code

1. **Never send raw payloads.** The ledger stores a **hash** (`payloadHash`) only; the data stays in the caller's systems. Pass the real payload to `record`/`wrapTool` — the SDK hashes it. Never put secrets/PII where you think the *hash input* is logged.
2. **Scopes gate targets.** A receipt's `target` must be covered by a delegation scope. `crm.*` covers `crm.lookup`; wildcards end in `.*`; `*` covers everything. An out-of-scope action is rejected.
3. **Delegation is owner→agent, scoped and expiring.** An agent can only *narrow* authority, never widen it. `exp` is required. Revocation is a first-class ledger entry.
4. **Writes need an API key** (`zk_live_…`) as `apiKey` / `api_key`. **Reads are public** on `ledger.zanii.agency` (proofs, verify, stats, export): no key. A self-hosted log with a `restricted` or `private` read policy needs the key on reads too (`apiKey` / `api_key` on the read helpers).
5. **Receipts are content-addressed → idempotent.** Resubmitting the same receipt returns `{"status":"duplicate"}`, not an error. **Do not invent your own idempotency keys.**
6. **Always verify offline.** Never trust the server's assertion: use `verifyAuditBundle` / `fetchAndVerifyProof` (they check signature → delegation → scope → Merkle inclusion → signed tree head). `ProofCheck` has `ok` and `checks`; it has no `error` field.
7. **Timestamps are UTC ISO-8601 with `Z`** (e.g. `2027-01-01T00:00:00Z`).
8. **For enforced action rules** (no-external-receipt→no-"sent", human gate for money/irreversible actions), use **`zanii.runtime` / `@zanii/runtime`** — do not hand-roll it. See `reference/*` .
9. **Keys are secrets.** Ed25519 private keys and `zk_live_`/`zk_admin_` keys are shown once — write them to files (mode 600) or a secrets manager, never hardcode or commit. In production prefer an **HSM / cloud KMS**: pass `signer: { publicKey, sign }` (`signer=` in Python) instead of `agentPrivateKey`; the SDK checks every signature against `agentDid`.
10. **Match errors on `code`, never on message text.** `isZaniiError(e, 'QUEUE_FULL')`, `e.code`, `ZaniiHttpError.status` / `serverCode` (Python `is_zanii_error`, `server_code`). Codes are stable and never reused; messages are kept only for old code.
11. **`await using` needs `Symbol.asyncDispose`** (Node 24 and current runtimes). Elsewhere `try/finally` with `await agent.close({ flush: true })`. A bare `close()` does not flush. Python: `with ZaniiAgent(...)` / `async with AsyncZaniiAgent(...)`.
12. **Paged verification proves chain, inclusion, anchors and revocations only.** Use `fetchAndVerifyBundle` / `fetch_and_verify_bundle` for proof details, settlement and witness states, and never report a paged `ok` as settlement or witness evidence. A run is proven only when the final `ok` is true.
13. **SQL journal: one owner per agent and log.** A second writer gets `JOURNAL_OWNED`; never share one journal between live processes. `takeover: true` only after the old process is confirmed gone. Recovery replays exact signed receipts, never business actions. The 32-byte journal key is a secret (lose it and the journal is unreadable); close the journal after the agent.
14. **Never put API keys, private keys, nonces or private payloads in logs**, error reports, targets or metadata. SDK errors and `details` already exclude them; delivery callbacks give hashes, statuses and counts, so log those.
15. **Behaviour since 0.6.0 / 0.27.0** (wire v1, signed bytes and old call forms unchanged; new options opt-in): the SDK refuses success-looking failed HTTP responses; `@zanii/runtime` 0.4.0 rejects what used to slip (authority and final confirmation re-checked, immutable approvals, atomic budgets); on restricted and private deployments account admin reads need the admin key; Python `salted_payload_hash(p, "")` now commits unsalted; after `retry.maxAttempts` failures receipts stay queued until an explicit `flush()`; delivery `accepted` is not anchoring or business success; a revocation status read covers only what that log reports now.

## Load these references when the task needs depth

- `reference/typescript.md`: full TS: SDK, revocation, payload checks, journals, paged export, errors, runtime, MCP proxy, A2A.
- `reference/python.md`: full Python equivalents (incl. `zanii.aio`, `zanii.errors`, `zanii.sql_journal`, `zanii.runtime`, `zanii.mcp_proxy`).
- `reference/api.md`: the ledger HTTP API (accounts, keys, webhooks, proofs, revocations, paged export, read policies).
- `reference/patterns.md`: common patterns (scope exit, journal ownership, paged verification, retries) and the mistakes models make.
- `reference/ecosystem.md`: how Certify, Blackbox and Underwrite relate to this release, and the optional packages (all published): `@zanii/{ai,webhooks,testing,monitor,react}`, the ten standalone (`cli,gateway,compliance,kms,witness,policy,otel,payments,embed,connectors`), the framework/privacy set (`langchain,openai-agents,retention,redact` + `zanii.crewai`), the standards-landing set (`a2a-directory,x402,erc8004`), the UAE-compliance set (`consent,admissibility,fta,walls`), `memory` (provable hash-chained agent memory), and the trust-boundary set (`kya,attest,swarm`; swarm has the on-ledger authority layer for `POST /v1/swarm`).
