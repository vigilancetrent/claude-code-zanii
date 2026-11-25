# Zanii: patterns & gotchas (what models get wrong)

## Common mistakes to avoid
- **Sending raw payloads to the ledger.** You don't — you pass the payload to `record`/`wrapTool`
  and the SDK sends only its **hash** (`payload_hash`). The ledger never contains the data. When
  showing this to a user, say "only a fingerprint is stored".
- **Target not covered by scope.** `record({target:'email.send'})` with only `crm.*` delegated is
  **rejected**. Grant a scope that covers the target: `email.*` covers `email.send`.
- **Assuming `payload_hash` is a bare/deterministic hash.** As of 0.3.0 `record()` **salts** by
  default (`sha256(nonce ‖ payload)`), so identical payloads differ on the log (privacy/PDPL). Don't
  dedupe by `payload_hash`. To later *prove* a payload, keep the returned `nonce` (or a `nonceStore`)
  and use `verifyPayload(payload, nonce, hash)`; pass `salt:false` only if you truly need determinism.
- **Reinventing idempotency.** Receipts are content-addressed; the same receipt resubmits as
  `duplicate`. Don't add `Idempotency-Key` headers or dedupe logic.
- **Trusting the server response.** The whole point is zero-trust. Show verification via
  `verifyAuditBundle` / `fetchAndVerifyProof`, not "the API said ok".
- **Forgetting `flush()`.** `record()` queues; call `flush()` (or let the batch timer fire) to ship. At the
  end of a scope use `await using` / `with ZaniiAgent(...)`, or `close({ flush: true })` / `close(flush=True)`:
  a bare `close()` does NOT flush.
- **Reading `proof.error`.** `fetchAndVerifyProof` returns `{ ok, checks, receipt?, sth?, payload? }`; there is
  no `error` field. Report the failed `checks[].label`s.
- **`createRevocation(cert, key)`.** The signature is `createRevocation(cert, ts, issuerPrivateKey)` /
  `create_revocation(cert, ts, issuer_private_key)`; creating it only signs a file. Send it with
  `submitRevocation` / `submit_revocation` (or `zanii revoke --submit`), or the log never learns.
- **Matching error messages.** Branch on `e.code` / `isZaniiError(e, code)` / `is_zanii_error(e, code)`.
  Messages are kept for old code, not a contract.
- **Treating `accepted` as done.** A delivery `accepted` means the log stored the receipt: not anchored,
  not settled, and not proof the business action succeeded.
- **Hardcoding keys.** Ed25519 private keys and `zk_live_`/`zk_admin_` tokens are secrets — env or a
  file (mode 600), shown once, never committed.
- **Non-UTC timestamps.** Use ISO-8601 with `Z`. `exp` on a cert is required.
- **Runtime: passing delegation differently.** Python `Runtime(agent, tools)` reads `agent.delegation`;
  TypeScript `new Runtime(agent, { tools, delegation })` needs `delegation` passed explicitly.
- **TS import location.** As of **`@zanii/sdk` v0.2.1**, `@zanii/sdk` re-exports the verification +
  revocation helpers (`verifyReceipt`, `verifyAuditBundle`, `createRevocation`, `verify*`), so a single
  `@zanii/sdk` install builds AND verifies. (`@zanii/core` = the same helpers, no client. Python: `zanii`
  for the client, `zanii.core` for verification — both re-export the verify helpers.)

## Gotchas in the newer packages (these WILL be got wrong)

- **🔴 `@zanii/health`: never give a provider the SEED — only a TAG.** `episodeTag(seed, n)` is derived
  by the **patient**, who hands the provider **one opaque string**. A provider holding the *seed* can
  enumerate `n` and reconstruct the patient's entire cross-institution history — the privacy gain
  becomes zero, and *illusory*. There is a red test guarding this. Never "simplify" by passing the seed.
- **`@zanii/health` ≠ `@zanii/subject` tags.** `subjectTag(did, platform)` is **stable and linkable**
  (correct for a citizen who *wants* one appealable slice). `episodeTag(seed, n)` is **deliberately
  unlinkable** (correct for medicine, where access *frequency* is itself PHI). Don't swap them.
- **`protocolTrail` is NOT `ruleConsistency`.** In `@zanii/gov`, "the same rulebook decided everyone"
  is the fairness property and **interleaving is a red flag**. In `@zanii/health` that would be a
  **clinical error** — individualised care is correct and protocols legitimately coexist. `protocolTrail`
  has **no `consistent` field**, on purpose. Never report "inconsistent protocols" as a defect.
- **`manifest_hash` is REQUIRED, and the builders throw.** `buildGovDecision`, `buildDecisionReceipt`,
  and `buildRecommendation` all reject a missing rulebook/protocol hash. This is intentional: an
  unauditable state or clinical decision must not be *constructible*. Don't work around it — supply the
  deployed policy/protocol version hash.
- **`@zanii/credentials`: `ok` is never true on an unchecked assumption.** Omit the `resolver` and it
  reports *"institutional identity was NOT verified"* — the signature then proves only that **some** key
  signed it, not that it was the university. Omit the revocation list and it reports *"revocation NOT
  checked"*. Always pass a resolver. And a credential is **not a bearer token** — use
  `buildPresentation`/`verifyPresentation` so a thief with the *file* but not the *key* fails.
- **`@zanii/swarm`: `verifySwarm` ≠ `verifySwarmReceipt`.** `verifySwarm` checks only that N keys
  **signed** (offline crypto). `verifySwarmReceipt` is **authority-complete** (delegation + scope + prev
  + revocation + distinct owners) and is what `POST /v1/swarm` enforces. **A signature is not authority** —
  never present the first as proof the team was authorised.
- **`@zanii/sentinel`: persist the cursor, or you re-alert on restart.** `createWatcher({ cursor })` —
  save `w.cursor()` between runs. The watcher also keeps a **rolling window** so multi-step detections
  (an exfil sequence arriving one step per poll) actually fire; don't "optimise" it to scan only fresh
  receipts. And `escalationRule` returns **null** when a finding names no targets — never fabricate a
  `*` rule, which would gate the agent's entire surface.
- **Floats are banned in protocol objects.** JCS and `json.dumps` can disagree on them, so `jcs_hash`
  **throws** on a float in Python (and TS would silently produce a *different* hash — a cross-language
  divergence). Use integer minor/milli units, as `@zanii/payments` and `@zanii/sentinel` baselines do.
- **`@zanii/custody`/`provenance`: don't over-claim.** Custody proves *who signed for the goods*, never
  what was in the box ("attestations, not atoms"). A content credential proves *who signed*, never *who
  authored*. Fraud becomes **attributable**, not impossible. Say it that way.
- **`@zanii/escrow`: a receipt without inclusion evidence is a claim, not a trigger.** `checkRelease`
  only returns `ok` when the receipt carries a **verified Merkle inclusion proof** — never release on a
  bare receipt, however valid its signature. And remember who authorizes what: release = the **payer**
  (giving up funds), refund = the **payee** (giving up the claim), arbiters for either — Zanii never
  holds funds and cannot force a transfer; a refusal after a valid release is *provable breach*, not
  prevented breach.
- **`@zanii/insurance`: never invent a score, and never read silence as safety.** The package emits
  **facts and named flags** deliberately — resist the urge to collapse them into a number (it gets gamed
  and creates liability; insurers price). `THIN_HISTORY`/`STALE` exist because an agent that never
  receipts its failures looks safer than it is. In `assessClaim`, `unproven` incidents are a fact for
  the adjuster, **not** a rejection — don't treat them as one.
- **`@zanii/federation`: differing tree sizes are NOT equivocation.** Two same-size STHs with different
  roots are damning; different sizes can be honest growth between fetches — use `@zanii/monitor`'s
  consistency proofs for append-only. And `verifyFederatedSth` counts only **distinct,
  policy-recognised** witnesses — a pile of co-signatures from unknown DIDs proves nothing.
- **`@zanii/succession`: succession records continuity, revocation kills authority — do BOTH.**
  A succession cert does not disable the old key; after a compromise, also revoke the old
  delegation or the attacker keeps acting under it. And `reason:'compromise'` REQUIRES
  `compromised_at` (build-time throw) — without the bracket, inherited history can't be honestly
  assessed. Never treat `combinedSummary` totals as deduplicated: they are labeled an upper bound.
- **`@zanii/sla`: hand `assessCompliance` the CONSECUTIVE chain segment, not a filtered list.**
  The completeness proof is the `prev`-link check — pre-filtering receipts (by scope, by "relevant"
  ones) breaks the chain and produces `INCOMPLETE_RECORD` on an honest provider. Pass the raw
  export slice; the function does the in-window/in-scope filtering itself. Use `asOf` for
  mid-window checks or the trailing silence counts as breach.
- **`@zanii/constitution`: `manifest_hash` is the whole mechanism — stamp it or nothing binds.**
  An agent that records without `provenance.manifestHash` produces *ungoverned* actions, which
  `verifyGovernance` flags but nothing prevents. The constitution constrains only when the
  verifier demands the stamp. And `require_approval` results are a to-do list for the auditor
  (demand the owner-signed confirmations) — the package deliberately does not verify them.
- **`@zanii/pq`: record the transition UNSALTED (`salt: false`).** `record()` salts payloads by
  default, which makes `payload_hash` unverifiable without the nonce — `verifyTransition` will
  fail with "was it recorded salted?". A PQ binding is public by design; the unsalted hash is the
  point. And never accept an Ed25519-only fallback where dual-signing was promised — `verifyDual`
  refuses it, so should any custom verifier.
- **`@zanii/broker`: the invariant is receipt-BEFORE-call, and it only works if the keys move.**
  The `record` function you inject MUST throw unless the receipt is durably accepted (record +
  flush + check the submit results — a fire-and-forget queue defeats the whole point). And the
  broker removes the agent's *need* for credentials; it cannot remove credentials the operator
  left in the agent's env — deploy it as a separate process AND delete the raw keys. Allow-list
  entries are origins + path prefixes, required and non-empty; never grant `*`. Confirm the receipt
  **by its hash**: `SubmitResult` has `status` (`accepted` / `duplicate` / `rejected`), not `ok`, and
  with concurrent calls one `flush()` can ship another call's receipt, so check for your own hash.
- **`@zanii/vc`: bridge the format, never claim the trust model.** A VC from `toVC` proves what
  the Zanii credential proved — `verifyVC` checks the proof and (only with explicit `at`) the
  window; it does NOT check revocation or resolve the issuer's domain. Acceptance still needs
  `@zanii/credentials` `verifyCredential`. And never map W3C StatusList cosmetically — a
  revocation mechanism you don't actually serve is a liveness lie.
- **`@zanii/kyb`: both halves or nothing.** A signed attestation without the domain's
  `.well-known` listing proves nothing (anyone can sign a claim); a domain listing without the
  key's attestation proves nothing (anyone can list any DID). And domain control ≠ corporate
  registration — never present a kyb `ok` as "Zanii verified this company"; present it as "the
  key and the domain agree who they are, attributably."
- **`@zanii/chain-bridge`: the registry DID is a claim until the binding check passes.** The L1's
  agent registry metadata is self-asserted — anyone can paste anyone's `did:key`. Never resolve a
  chain agent's ledger history from the raw metadata; go through `verifyChainAgentBinding` /
  `resolveChainAgent` (which refuses to touch the ledger on a failed binding). And remember what
  a pass means: **key identity only** — role/capabilities in metadata stay unverified, and a chain
  *name* is first-come, not a trademark. ZAN amounts are integer zi (9 dp) — `parseMoney(x,'ZAN')`,
  never a float.
- **`@zanii/cv`: the `summary` is trustworthy; the curated sections are not *complete*.** A CV's
  `summary` is the ledger's own count (from `/v1/reputation`) — the agent **cannot inflate** it. But
  `work`/`benchmarks`/`skills` are **curated**: each entry is verifiable, yet the agent chose *which* to
  include and can omit a bad run. Never present a CV's work list as the agent's *complete* history —
  `verifyCV` even warns when the list exceeds `summary.receipts`. A CV proves its entries are real, not
  that nothing was left out. And `verifyCV` is offline/structural — to verify the underlying history,
  follow `summary.audit_bundle` (`verifyAuditBundle`) or `resolveAndVerify`.
- **Role CVs: never rank an incomplete CV.** `buildRoleCV` says `complete: false` (with `problems`) when an instance
  is missing, a chain is broken or behind the Ledger head; rank only complete ones, and remember unknown outcomes
  count against the success rate. Without outcome receipts there is no success rate to prove.
- **Threat signatures are plain text.** Never turn a `contains:` signature into a regular expression, and never
  publish one built from a customer's call arguments: candidates leave a firm as target patterns only.

## 0.6.0 / 0.27.0 patterns

**Scope exit.** TS `await using agent = new ZaniiAgent(...)` runs `close({ flush: true })` at block end and
needs `Symbol.asyncDispose` (Node 24+); on older runtimes use `try { ... } finally { await agent.close({ flush: true }) }`.
Python `with ZaniiAgent(...) as agent:` (or `async with AsyncZaniiAgent(...)`) flushes and closes and never
masks the block's exception. A failed final flush leaves receipts queued, and journaled if a journal is set.

**Never lose receipts at exit.** Memory only: add `flushOnExit: true` (TS, one attempt at `beforeExit`) or
`flush_on_exit=True` + `flush_interval=` (Python). Those only reduce loss on a clean exit; for crashes and
redeploys configure a journal and call `recoverPendingReceipts()` / `recover_pending_receipts()` at startup.

**SQL journal ownership and takeover.** One owner per (agent DID, log URL). `open` claims an owner row
(`ON CONFLICT DO NOTHING`); every write is fenced on that owner token, so a second process gets
`JOURNAL_OWNED` and a fenced-out writer stops (`JOURNAL_STOPPED`) instead of forking the chain. A clean
`journal.close()` releases ownership; after a crash the row stays, and an operator reopens with
`takeover: true` / `takeover=True` only once the old process is confirmed dead (two live writers fork
evidence). Several agents can share one database: ownership is per agent. Recovery replays the exact
signed receipts and never re-runs a business action. Keep the 32-byte key in a secrets manager.

**Custom journals: run the conformance kit** before relying on one:
```ts
import { DatabaseSync } from 'node:sqlite';
import { runJournalConformance } from '@zanii/sdk/journal-testkit';
import { SqlReceiptJournal, sqlJournalSchema } from '@zanii/sdk/sql-journal';

const db = new DatabaseSync(':memory:');
const tables = new Map<string, string>();
const table = (slot: string) => {                 // a fresh table set per scenario
  if (!tables.has(slot)) {
    const name = `conf_${tables.size}`;
    for (const statement of sqlJournalSchema('sqlite', name)) db.exec(statement);
    tables.set(slot, name);
  }
  return tables.get(slot)!;
};
const result = await runJournalConformance((c) => SqlReceiptJournal.open({
  query: (text, params) => db.prepare(text).all(...(params as never[])) as Array<Record<string, unknown>>,
  dialect: 'sqlite', table: table(c.slot), agentId: c.agentId, serverUrl: c.serverUrl, key: new Uint8Array(32).fill(1),
}));
console.log(result.passed, result.skipped);      // throws JOURNAL_CONFORMANCE_FAILED naming the broken guarantee
```
```python
import sqlite3
from zanii.journal_testkit import run_journal_conformance
from zanii.sql_journal import SqlReceiptJournal, sql_journal_schema

db = sqlite3.connect(":memory:", check_same_thread=False)
tables = {}

def table(ctx):                                  # a fresh table set per scenario
    if ctx["slot"] not in tables:
        tables[ctx["slot"]] = name = f"conf_{len(tables)}"
        for statement in sql_journal_schema("sqlite", name):
            db.execute(statement)
        db.commit()
    return tables[ctx["slot"]]

result = run_journal_conformance(lambda ctx: SqlReceiptJournal(
    db, agent_id=ctx["agent_id"], server_url=ctx["server_url"], key=bytes(32), table=table(ctx)))
print(result["passed"], result["skipped"])       # raises AssertionError (JOURNAL_CONFORMANCE_FAILED) naming the guarantee
```
Pass a `corrupt` hook to also check fail-closed handling of damaged evidence (skipped otherwise).

**Paged verification.** For exports too big for one response, `fetchAndVerifyBundlePaged` /
`fetch_and_verify_bundle_paged` keeps memory at one page and fails unless it reaches the advertised
total on one pinned tree head. Process data in `onPage` / `on_page` (each page is already verified),
but treat the run as proven only when the final `ok` is true. It covers chain, inclusion, anchors and
revocations; settlement, witness and per-proof details still need `fetchAndVerifyBundle`.

**Retries and callbacks.** Bound automatic retries with `retry.maxAttempts` and alert from `onFailed`;
after exhaustion receipts stay queued until an explicit `flush()`. Callbacks get hashes, statuses and
counts: log those, never payloads, nonces or keys. A throwing callback is ignored, so it cannot break delivery.

**Revoking a leaked agent key.** Revoke every delegation cert issued to that agent DID
(`createRevocation` + `submitRevocation`, owner key), confirm with `checkRevocation`, then mint a new agent
keypair with a fresh cert. Optionally record continuity with `@zanii/succession` (`reason: 'compromise'`
plus `compromised_at`). The status read only covers what that log reports now.

## Choosing the layer
- Just need to **verify** someone else's proof/bundle → `@zanii/core` / `zanii.core`, no server, no key.
- **Instrument your agent** to emit receipts → `@zanii/sdk` / `zanii`.
- Want the agent's actions **governed** (no-proof-no-claim, human gate for money) → `@zanii/runtime`.
- Agent already speaks **MCP** and you want zero code changes → `@zanii/mcp-proxy`.
- An **end user / citizen / patient** must audit what was done *to them* → `@zanii/subject`
  (stable slice), `@zanii/gov` (state decisions + `appealPack`), `@zanii/health` (unlinkable episodes).
- Verify a **diploma, licence or certification** offline → `@zanii/credentials` (pass a resolver!).
- Detect a **compromised/drifting agent** from the receipt stream → `@zanii/sentinel`.
- Prove **physical custody** or **content origin** → `@zanii/custody` / `@zanii/provenance`.

## Self-serve onboarding (no human in the loop)
1. `POST /v1/account/signup {name}` → save `admin_key`.
2. `POST /v1/account/keys` (admin) → `api_key` (`zk_live_`). Put it in `ZANII_API_KEY`.
3. Instrument with the SDK using that `apiKey`. Reads stay public.

## Compliance / trust talking points (accurate)
- Records are **tamper-evident** (Merkle inclusion + consistency proofs) and **anchored on a public
  chain**, so history can't be rewritten, even by the operator.
- **Data minimisation**: only hashes are stored → strong GDPR/PDPL posture; nothing private to leak.
- **No lock-in**: open protocol, offline open-source verifier, one-file export.
- Don't claim SOC 2 / certifications that aren't held — say "on the roadmap".
- **Never say Zanii "accredits" anyone.** `@zanii/credentials` verifies that whoever controls a
  **domain** published an issuing DID. We are the verification layer, **not** an accreditation
  authority — becoming one would make us a political chokepoint and a liability sink.
- **Never say a receipt proves an outcome was *right*.** `@zanii/gov` proves the **process** (same
  rules, complete record, committed inputs) and **never the justice** of a decision. `@zanii/health`
  proves which model, which protocol, which clinician signed — **never** that the treatment was
  correct. A rule applied consistently may still be unlawful; that judgment is the court's.

## Wildcard scope semantics
`scope_covers(scope, target)`: `*` covers all; `email.*` covers `email` and `email.<anything>`;
otherwise exact match. Grant scopes deliberately and narrowly.
