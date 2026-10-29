# Zanii: TypeScript reference

Packages (npm): `@zanii/sdk` **0.6.0 or later** (with `@zanii/core` ^0.5.6), `@zanii/runtime` 0.4.0,
`@zanii/mcp-proxy` 0.2.5. Install: `npm i @zanii/sdk@^0.6.0` (under 0.x semver `^0.5.4` does NOT pick up 0.6).
Import rule: **`@zanii/sdk` is a superset**: the `ZaniiAgent` client, `fetchAndVerifyProof`, the 0.6.0
helpers, and all the protocol + verification helpers re-exported from core (`generateKeypair`,
`createCert`, `createRevocation`, `verifyReceipt`, `verifyAuditBundle`, `verifySTH`, `verifyInclusion`,
`verifyConsistency`, `verifyChain`, `verifyA2AReceipt`, `verifyPayload`, ...). So **`@zanii/sdk` alone
builds AND verifies.** Use `@zanii/core` only for the pure helpers with no client.

Subpath entries (Node only, never loaded by the main entry): `@zanii/sdk/durable` (`FileReceiptJournal`),
`@zanii/sdk/sql-journal` (`SqlReceiptJournal`, `sqlJournalSchema`), `@zanii/sdk/journal-testkit`
(`runJournalConformance`), `@zanii/sdk/evidence` (private evidence, audit packs, capture; install
`@zanii/redact` and `@zanii/compliance` too), `@zanii/sdk/daemon` (`DaemonAgent` for `@zanii/signerd`).

Optional add-ons (all published) live in `reference/ecosystem.md`.

Accountability: `record()` **salts** the payload by default (keep the returned `nonce` or pass a
`nonceStore` to prove it later; `salt: false` to opt out); `createConfirmation`/`verifyConfirmation`
+ `new Runtime(agent, { ownerDid })` (signed human approvals); provenance via
`record({ provenance: { manifestHash } })`; `createCoSignature` + `@zanii/compliance` `reconcile`. SPEC §12/§13.

## Identity, delegation, revocation
```ts
import { generateKeypair, createCert, createRevocation, submitRevocation, checkRevocation, listRevocations } from '@zanii/sdk';

const owner = generateKeypair();              // { privateKey: Uint8Array, publicKey, did: 'did:key:z...' }
const agent = generateKeypair();
const cert = createCert(
  { issuer: owner.did, subject: agent.did, scopes: ['email.*', 'crm.read'], exp: '2027-01-01T00:00:00Z' },
  owner.privateKey,                            // signed by the OWNER
);

// Revoke (e.g. a leaked agent key): owner-signed record, then send it to the log.
const revocation = createRevocation(cert, new Date().toISOString(), owner.privateKey);
const sent = await submitRevocation('https://ledger.zanii.agency', revocation, { apiKey: process.env.ZANII_API_KEY });
// sent.status is 'accepted' or 'duplicate' (the log already had it); sent.cert_hash names this cert
const status = await checkRevocation('https://ledger.zanii.agency', cert);  // { revoked, cert_hash, index?, ts? }
const all = await listRevocations('https://ledger.zanii.agency');           // [{ cert_hash, index, ts }]
```
`submitRevocation` verifies the record is signed by the cert's issuer before sending
(`REVOCATION_INVALID` otherwise) and accepts only an answer naming this cert. A status read covers
only what that log reports now. CLI: `zanii revoke --owner owner.json --cert cert.json --submit`.

## Instrument an agent
```ts
import { ZaniiAgent } from '@zanii/sdk';

const zanii = new ZaniiAgent({
  serverUrl: 'https://ledger.zanii.agency',
  agentDid: agent.did,
  agentPrivateKey: agent.privateKey,
  delegation: [cert],
  apiKey: process.env.ZANII_API_KEY,           // zk_live_..., required for writes
  // flushMs?: 300, flushSize?: 20, maxQueue?: 10_000, fetchImpl?, nonceStore?, journal?, signer?
});

// (a) wrap a tool: every call is signed + recorded (result on success, error on failure)
const sendEmail = zanii.wrapTool('email.send', (to: string, subj: string) => mail.send(to, subj));
await sendEmail('a@b.co', 'Hi');

// (b) record explicitly
const { receipt, hash, nonce } = await zanii.record({ target: 'crm.read', payload: { email: 'a@b.co' } });
await zanii.flush();                            // ship queued receipts

// (c) record and wait for the log's answer for THIS signed hash
const confirmed = await zanii.recordAndConfirm({ target: 'crm.read', payload: { id: 7 } }, { timeoutMs: 10_000 });
confirmed.delivery.status;                      // 'accepted' | 'duplicate' | 'rejected' | 'unknown'
```
Key in an HSM / cloud KMS (sdk 0.5.4+): pass `signer: { publicKey, sign: (msg) => Promise<Uint8Array> }`
instead of `agentPrivateKey`; it must match `agentDid` and every signature is checked. With a signer,
finish A2A with `await zanii.a2aFinalizeAsync(accepted)`.

## Close at scope exit, never lose receipts at exit
```ts
{
  await using zanii = new ZaniiAgent({ serverUrl, agentDid: agent.did, agentPrivateKey: agent.privateKey, delegation: [cert], apiKey });
  await zanii.record({ target: 'crm.read', payload: { id: 1 } });
} // [Symbol.asyncDispose] runs close({ flush: true }) here
```
`await using` needs `Symbol.asyncDispose` (Node 24 and current runtimes; TS `lib` with `esnext.disposable`).
Elsewhere call `await zanii.close({ flush: true })` in a `finally`. `close()` defaults to `flush: false`:
it stops new recording, waits for active work, keeps queued receipts (in the journal, if configured),
and never cancels a business action. Opt-in `flushOnExit: true` makes ONE delivery attempt at Node's
`beforeExit` for receipts left queued after an outage; it adds no timer and is removed by `close()`.
Without a journal the queue is memory only: a hard crash still loses unshipped receipts.

## Retries and delivery callbacks
```ts
const agentWithRetry = new ZaniiAgent({
  serverUrl, agentDid: agent.did, agentPrivateKey: agent.privateKey, delegation: [cert], apiKey,
  retry: { maxAttempts: 8, baseMs: 500, capMs: 60_000, jitter: 0.2 },
  onDelivered: (d) => console.log(d.status, d.hash),          // every log answer, per receipt
  onRetrying: ({ attempt, delayMs, queued }) => console.warn('retry', attempt, delayMs, queued),
  onFailed: ({ attempt, queued }) => console.error('ledger unreachable', attempt, queued),
});
```
Defaults keep the old schedule (unlimited, `flushMs` doubling, 30 s cap, no jitter). After `maxAttempts`
consecutive failures automatic retries stop, receipts stay queued (nothing dropped) and only an
explicit `flush()` retries. A callback that throws is ignored. `getDeliveryStatus()` returns counts.

## Verify (offline, zero trust)
```ts
import { fetchAndVerifyProof, parseProofTarget, verifyReceipt, verifyAuditBundle } from '@zanii/sdk';

const proof = await fetchAndVerifyProof('https://ledger.zanii.agency', hash); // fetch + verify
if (!proof.ok) throw new Error(proof.checks.filter((c) => !c.ok).map((c) => c.label).join(', '));

// Check the proof AND that it commits to this payload (pass the nonce record() returned; omit it for salt:false).
// The target may be a bare hash, a /verify/<hash> path or a full /verify URL ('' server = use the URL's log).
const withPayload = await fetchAndVerifyProof('', `https://ledger.zanii.agency/verify/${hash}`, fetch,
  { payload: { email: 'a@b.co' }, nonce });
withPayload.payload?.status;                    // 'matches' | 'mismatch' (then ok is false) | 'not_checked'
parseProofTarget(`https://ledger.zanii.agency/verify/${hash}`); // { hash, serverUrl: 'https://ledger.zanii.agency' }

const r = verifyReceipt(receipt);              // signature + delegation + scope, no network
```
`ProofCheck` has `ok`, `checks` (`{ label, ok }[]`), `receipt`, `sth`, `payload`; there is no `error`
field. `getProofDetails(evidence, { payload, nonce })` is the pure, offline form.
`fetchAndVerifyBundle(server, did)` downloads and verifies the complete v1 bundle with per-state proof
details (settlement/witness callbacks, `requireSettlement`, `requireWitness`); `verifyAuditBundle(bundle)`
verifies a bundle you already hold; `waitForAnchor(server, hash, fetch, { agentId })` polls for anchoring.

## Verify a huge export page by page
```ts
import { fetchAndVerifyBundlePaged } from '@zanii/sdk';

const paged = await fetchAndVerifyBundlePaged('https://ledger.zanii.agency', agent.did, fetch, {
  pageSize: 500,                                // 1..1000 receipts per page; memory is bounded by one page
  onPage: (page) => console.log(page.offset, page.receipts.length, page.total),
});
if (!paged.ok) throw new Error(paged.failure);
paged.receipts; paged.pages; paged.head; paged.revokedCerts; paged.anchoredThrough; paged.paged;
```
Every page is pinned to the first page's signed tree head (`?limit=&offset=&size=`), the agent chain
must continue across pages, and the run fails unless it reaches the advertised total. A server
without paging returns one complete bundle, verified as one page (`paged: false`). It proves chain,
inclusion, anchors and revocations only; use `fetchAndVerifyBundle` for proof details, settlement
and witness states.

## Survive restarts and multiple hosts: SQL journal
```ts
import { DatabaseSync } from 'node:sqlite';
import { SqlReceiptJournal, sqlJournalSchema } from '@zanii/sdk/sql-journal';

const db = new DatabaseSync('zanii-journal.db');
for (const statement of sqlJournalSchema('sqlite')) db.exec(statement); // run once, as a migration
const journal = await SqlReceiptJournal.open({
  query: (text, params) => db.prepare(text).all(...(params as never[])) as Array<Record<string, unknown>>,
  dialect: 'sqlite',                            // or 'postgres' with (t, p) => pool.query(t, p).then((r) => r.rows)
  agentId: agent.did, serverUrl: 'https://ledger.zanii.agency',
  key: journalKey,                              // caller-held 32-byte key (AES-256-GCM sealing); losing it = unreadable
  // takeover: true                             // ONLY after the previous owner process is confirmed gone
});
const durable = new ZaniiAgent({ serverUrl: 'https://ledger.zanii.agency', agentDid: agent.did,
  agentPrivateKey: agent.privateKey, delegation: [cert], apiKey, journal });
await durable.recoverPendingReceipts();         // after a restart: replay exact signed receipts, never business actions
await durable.recordDurably({ target: 'crm.read', payload: { id: 9 } }); // persisted before transport
await durable.close({ flush: true });
await journal.close();                          // close the journal only after the agent
```
One owner per (agent, log): a second `open` fails with `JOURNAL_OWNED`; a fenced-out writer stops
instead of forking evidence. The single-host alternative is `FileReceiptJournal.open({ path, agentId,
serverUrl, key })` from `@zanii/sdk/durable`. Custom journals: `runJournalConformance` (see patterns.md).

## Handle errors by code
```ts
import { isZaniiError, ZaniiHttpError, ZANII_ERROR_CODES } from '@zanii/sdk';

try {
  await zanii.flush();
} catch (e) {
  if (e instanceof ZaniiHttpError) console.warn(e.code, e.status, e.serverCode); // HTTP_ERROR + the log's own code
  else if (isZaniiError(e, 'QUEUE_FULL')) console.warn(ZANII_ERROR_CODES.QUEUE_FULL);
  else throw e;
}
```
Families: `ZaniiConfigError`, `ZaniiStateError`, `ZaniiNetworkError` / `ZaniiHttpError` (`status`,
`serverCode`), `ZaniiResponseError`, `ZaniiVerificationError`, `ZaniiDelegationError`,
`ZaniiJournalError`, `ZaniiRevocationError`, all `extends ZaniiError extends Error`, with `code`,
optional `cause` and `details`. Messages are unchanged from before 0.6.0. Codes are never renamed.

## Deterministic runtime: `@zanii/runtime`
The model proposes; tested code disposes. Status is EARNED from the tool's result.
```ts
import { Runtime, tool, type ToolResult } from '@zanii/runtime';

const send = tool('email.send', 'email.*', async ({ to }): Promise<ToolResult> => {
  const providerId = await mail.send(to as string, 'Follow up');   // your integration
  return { ok: true, receiptId: providerId };         // provider receipt => status 'sent'
}, { irreversible: true });                            // money/messages/deletes => human gate

const rt = new Runtime(zanii, { tools: [send], delegation: [cert] }); // pass delegation explicitly (TS)
let d = await rt.propose('email.send', { to: 'a@b.co' }, { intent: 'follow up', confidence: 0.9 });
// irreversible => d.status === 'awaiting_confirmation'; nothing sent yet
d = await rt.confirm(d.confirmationId!);              // owner says yes => d.status === 'sent', recorded
```
Status: no `receiptId` => `attempted` (never `sent`); `confirmed:true` => `confirmed`; thrown => `failed`;
`partial:true` => `partial`. Unknown/out-of-scope tool => `rejected`; low `confidence` => `clarify`.
0.4.0 is stricter: authority and final confirmation are re-checked before dispatch, approvals are
immutable and bound to the exact action, budgets are atomic. A `failed` status after a timeout does
not prove no external effect happened: read `decision.execution`.

## MCP proxy: `@zanii/mcp-proxy`
Front any MCP server so every tool call is receipted, with no agent changes.
```ts
import { createZaniiProxy } from '@zanii/mcp-proxy';
const proxy = createZaniiProxy(upstreamClient, zanii); // upstream = connected @modelcontextprotocol Client
// serve `proxy` to your agent in place of the real server; each call recorded as mcp.<tool>
```

## Cross-org (A2A) receipts
Two agents from different orgs co-sign one neutral receipt (`POST /v1/interactions`):
`initiator.a2aDraft(...)` -> `responder.a2aAccept(draft)` -> `initiator.a2aFinalize(accepted)` (or
`a2aFinalizeAsync` with a signer) -> `initiator.submitInteraction(receipt)`. Low level: `@zanii/core`
`buildA2ABody` / `signA2ABody` / `assembleA2AReceipt` / `verifyA2AReceipt`. Journal mode refuses A2A.
