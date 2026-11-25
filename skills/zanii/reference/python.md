# Zanii: Python reference

Package (PyPI): `zanii` **0.27.0 or later** (`pip install "zanii>=0.27"`; Python 3.10+; `zanii.__version__`
reports the installed version). The Regulator Hub submodules - `zanii.regulator`,
`zanii.jurisdiction` and the rest listed below - need **0.28.0**: `pip install "zanii>=0.28"`. Threat signatures in
`zanii.status_feed` need **0.29.0**; role CVs and league tables in `zanii.cv` (`create_role_roster`, `build_role_cv`,
`firm_stats`, `league_table`) need **0.31.0**. Submodules: `zanii.core` (pure verify), `zanii.runtime` (rails),
`zanii.aio` (asyncio client), `zanii.errors` (typed errors), `zanii.durable` / `zanii.sql_journal` /
`zanii.journal_testkit` (receipt journals), `zanii.mcp_proxy` (needs `pip install "zanii[mcp]"`). Ships `py.typed`.
Ecosystem modules (every optional npm package with a Python use, same bytes as TypeScript wherever
they sign or hash): `zanii.{guard,ai,gateway,custody_verdicts,conformance,zk,robotics,energy,trading,elections,education,legal_ai,regulator,carbon,agent_bank,webhooks,testing,monitor,cli,
compliance,kms,witness,policy,payments,embed,connectors,retention,redact,a2a_directory,
x402,erc8004,consent,admissibility,fta,walls,memory,kya,attest,swarm,subject,provenance,custody,decisions,sentinel,credentials,gov,health,cv,escrow,insurance,federation,succession,sla,constitution,broker,vc,kyb,chain_bridge,train,identity_bridge,data_custody,residency,subprocessor,minimization,age_assurance}`; opt-in extras `zanii.otel` (`zanii[otel]`), `zanii.pq` (`zanii[pq]`, ML-DSA hybrid signing), `zanii.chain_bridge` (`zanii[chain]`, the Zanii L1 bridge) and framework adapters
`zanii.langchain` (`zanii[langchain]`), `zanii.openai_agents` (`zanii[openai-agents]`),
`zanii.crewai` (`zanii[crewai]`); see `reference/ecosystem.md`.

Accountability: `record()` **salts** the payload by default (keep the returned nonce or pass
`nonce_store=` to prove a payload later with `verify_payload`; `salt=False` to opt out);
`create_confirmation`/`verify_confirmation` + `Runtime(owner_did=...)` (signed human approvals);
receipt provenance via `record(provenance={"manifest_hash": ...})` / `Runtime(manifest_hash=...,
intent_receipts=True)`; `create_cosignature` + `zanii.compliance.reconcile` (segregation of duties).
The `zanii` console script mirrors the CLI (`zanii keygen`, `zanii verify <hash>`, `zanii revoke ... --submit`, ...).

## Identity, delegation, revocation
```python
import os
from datetime import datetime, timezone
from zanii import check_revocation, list_revocations, submit_revocation
from zanii.core import generate_keypair, create_cert, create_revocation

owner, agent = generate_keypair(), generate_keypair()   # Keypair(private_key: bytes, public_key, did='did:key:z...')
cert = create_cert(
    issuer=owner.did, subject=agent.did,
    scopes=["email.*", "crm.read"], exp="2027-01-01T00:00:00Z",
    issuer_private_key=owner.private_key,       # signed by the OWNER
)

# Revoke (e.g. a leaked agent key): owner-signed record, then send it to the log.
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
rev = create_revocation(cert, now, owner.private_key)
sent = submit_revocation("https://ledger.zanii.agency", rev, api_key=os.environ["ZANII_API_KEY"])
assert sent["status"] in ("accepted", "duplicate")
assert check_revocation("https://ledger.zanii.agency", cert)["revoked"]
entries = list_revocations("https://ledger.zanii.agency")   # [{"cert_hash", "index", "ts"}]
```

## Instrument an agent
```python
from zanii import ZaniiAgent

zanii = ZaniiAgent(
    server_url="https://ledger.zanii.agency",
    agent_did=agent.did, agent_private_key=agent.private_key,
    delegation=[cert],
    api_key=API_KEY,                            # zk_live_..., required for writes
    nonce_store={},                             # receipt hash -> payload nonce (persist it in production)
)
# (a) wrap a tool (sync or async): every call signed + recorded
lookup = zanii.wrap_tool("crm.read", crm.find)
lookup("a@b.co")
# (b) record explicitly; keep the nonce to prove the payload later
receipt, h = zanii.record(target="crm.read", payload={"email": "a@b.co"})
zanii.flush()
# (c) record and wait for the log's answer for THIS signed hash
confirmed = zanii.record_and_confirm("crm.read", {"id": 7}, timeout_seconds=10)
print(confirmed["delivery"]["status"])          # accepted | duplicate | rejected | unknown
```
Key in an HSM/KMS: `ZaniiAgent(..., signer=hsm)` instead of `agent_private_key`: any object with
`public_key` and `sign(message) -> bytes`; its key must be the one in `agent_did`, every signature is checked.

## Close at scope exit, background and exit flush
```python
with ZaniiAgent(server_url="https://ledger.zanii.agency", agent_did=agent.did,
                agent_private_key=agent.private_key, delegation=[cert], api_key=API_KEY,
                flush_interval=2.0,            # opt-in: ship the queue from a daemon thread (honours backoff)
                flush_on_exit=True,            # opt-in: one delivery attempt at interpreter exit
                exit_timeout=5.0) as scoped:
    scoped.record(target="crm.read", payload={"id": 1})
# __exit__ runs close(flush=True); a delivery failure never hides the block's own exception
```
`close()` defaults to `flush=False`: it stops new recording, waits for active work and keeps queued
receipts (in the journal, if configured). Exit and scope flushes only deliver: undelivered receipts
stay queued and journaled for `recover_pending_receipts`. Without a journal a hard crash loses them.

## Async servers: `zanii.aio.AsyncZaniiAgent`
```python
import asyncio
from zanii.aio import AsyncZaniiAgent

async def main():
    async with AsyncZaniiAgent(server_url="https://ledger.zanii.agency", agent_did=agent.did,
                               agent_private_key=agent.private_key, delegation=[cert], api_key=API_KEY) as az:
        receipt, h = await az.record(target="crm.read", payload={"id": 2})
        lookup = az.wrap_tool("crm.read", crm.find)     # returns a coroutine function (sync or async tools)
        await lookup("a@b.co")
        await az.flush()

asyncio.run(main())
```
Same arguments as `ZaniiAgent`; `record`, `flush`, `close`, `record_durably`, `recover_pending_receipts`,
`record_and_confirm`, `get_delivery_status`, `sync_head` and `close_session` are coroutines. It runs
the sync agent in worker threads (`asyncio.to_thread`, stdlib only), so receipts are byte-identical.
Cancelling an awaiting task does not cancel a call already running: check `get_delivery_status()`.

## Retries and delivery callbacks
```python
retrying = ZaniiAgent(
    server_url="https://ledger.zanii.agency", agent_did=agent.did,
    agent_private_key=agent.private_key, delegation=[cert], api_key=API_KEY,
    retry={"max_attempts": 8, "base_seconds": 0.5, "cap_seconds": 60, "jitter": 0.2},
    on_delivered=lambda d: print(d["status"], d["hash"]),       # every log answer, per receipt
    on_retrying=lambda e: print("retry", e["attempt"], e["delay_seconds"], e["queued"]),
    on_failed=lambda e: print("ledger unreachable", e["attempt"], e["queued"]),
)
```
Defaults keep the old schedule (unlimited, 0.3 s doubling, 30 s cap, no jitter). After `max_attempts`
consecutive failures receipts stay queued, `on_failed` fires and only an explicit `flush()` retries.
A callback that raises is ignored.

## Verify (offline, zero trust)
```python
from zanii import fetch_and_verify_proof, parse_proof_target
from zanii.core import verify_receipt, verify_audit_bundle

assert fetch_and_verify_proof("https://ledger.zanii.agency", h).ok
assert verify_receipt(receipt).ok              # signature + delegation + scope, no network

# Proof AND payload in one call; the target may be a hash, a /verify/<hash> path or a full URL.
check = fetch_and_verify_proof("", f"https://ledger.zanii.agency/verify/{h}",
                               payload={"email": "a@b.co"}, nonce=zanii.nonce_store[h])
print(check.payload["status"])                 # matches | mismatch (then ok is False) | not_checked
print(parse_proof_target(f"https://ledger.zanii.agency/verify/{h}"))   # {"hash", "server_url"}
```
`record()` returns `(receipt, hash)` only, so a salted payload is provable later only through
`nonce_store` (any persistent mapping, keyed by receipt hash). For `salt=False` receipts omit `nonce`. `get_proof_details(evidence, payload=..., nonce=...)` is the
offline form. `fetch_and_verify_bundle(server, did)` verifies a complete v1 bundle with proof details;
`verify_audit_bundle(bundle)` verifies one you hold.

## Verify a huge export page by page
```python
from zanii import fetch_and_verify_bundle_paged

result = fetch_and_verify_bundle_paged("https://ledger.zanii.agency", agent.did, page_size=500,
                                       on_page=lambda page: print(page["offset"], len(page["receipts"])))
assert result["ok"], result.get("failure")
print(result["receipts"], result["pages"], result["head"], result["revoked_certs"], result["paged"])
```
Pinned to one signed tree head, chain continuity across pages, fixed total; memory bounded by one
page. Proves chain, inclusion, anchors and revocations only: use `fetch_and_verify_bundle` for proof
details, settlement and witness states. Transport errors raise; verification failures return `ok: False`.

## Survive restarts and multiple hosts: SQL journal
```python
import sqlite3
from zanii.sql_journal import SqlReceiptJournal, sql_journal_schema

db = sqlite3.connect("zanii-journal.db", check_same_thread=False)   # or a psycopg connection + dialect="postgres"
for statement in sql_journal_schema("sqlite"):
    db.execute(statement)                                            # run once, as a migration
db.commit()
journal = SqlReceiptJournal(db, agent_id=agent.did, server_url="https://ledger.zanii.agency",
                            key=JOURNAL_KEY)    # caller-held 32 bytes; takeover=True only after the old owner is gone
durable = ZaniiAgent(server_url="https://ledger.zanii.agency", agent_did=agent.did,
                     agent_private_key=agent.private_key, delegation=[cert], api_key=API_KEY, journal=journal)
durable.recover_pending_receipts()              # after a restart: replay exact signed receipts, never business actions
durable.record_durably("crm.read", {"id": 9})   # persisted before transport
durable.close(flush=True)
journal.close()                                 # close the journal only after the agent
```
One owner per (agent, log): a second open raises `JOURNAL_OWNED`. The single-host alternative is
`zanii.durable.FileReceiptJournal(path, agent_id=, server_url=, key=)`.

## Handle errors by code
```python
from zanii.errors import ZANII_ERROR_CODES, ZaniiHttpError, is_zanii_error

try:
    zanii.flush()
except ZaniiHttpError as e:
    print(e.code, e.status, e.server_code)     # HTTP_ERROR + the log's own code, when it sent one
except RuntimeError as e:
    if not is_zanii_error(e, "QUEUE_FULL"):
        raise
    print(ZANII_ERROR_CODES["QUEUE_FULL"])
```
Each class also inherits the built-in it replaced (`ZaniiValueError`, `ZaniiTypeError`,
`ZaniiRuntimeError`, `ZaniiAssertionError`; `ZaniiHttpError` is a `RuntimeError`; `ZaniiNetworkError`
is a `urllib.error.URLError`), and messages are unchanged, so old `except` blocks keep working.

## Cross-org (A2A) on the agent
```python
draft = initiator.a2a_draft("quote.request", {"sku": "A-1"})   # sent to the responder
accepted = responder.a2a_accept(draft)                          # {"body", "sig"}, sent back
receipt_a2a, hash_a2a = initiator.a2a_finalize(accepted)       # local key or `signer`
initiator.submit_interaction(receipt_a2a)                       # POST /v1/interactions, re-syncs the head
responder.sync_head()                                           # before the responder records again
```
Same co-signed bytes as `@zanii/sdk`. Journal mode refuses A2A before signing. Low level:
`zanii.core` `build_a2a_body` / `sign_a2a_body` / `assemble_a2a_receipt` / `verify_a2a_receipt`.

## Deterministic runtime: `zanii.runtime`
```python
from zanii.runtime import Runtime, Tool, ToolResult, tool

def send(to):
    provider_id = mail.send(to)                # your integration
    return ToolResult(ok=True, receipt_id=provider_id)   # provider receipt => 'sent'

rt = Runtime(zanii, [Tool("email.send", "email.*", send, irreversible=True)])  # reads agent.delegation
d = rt.propose("email.send", {"to": "a@b.co"}, intent="follow up", confidence=0.9)
# irreversible => d.status == "awaiting_confirmation"; nothing sent yet
d = rt.confirm(d.confirmation_id)              # owner yes => d.status == "sent", recorded
```
Status: no `receipt_id` => `attempted` (never `sent`); `confirmed=True` => `confirmed`;
raised => `failed`; `partial=True` => `partial`. Unknown/out-of-scope => `rejected`; low confidence => `clarify`.
Execution helpers (`validate_action`, `execute_with_evidence`, `execute_once`, `cancel_action`,
`get_action_status`, `cancel_confirmation`) never re-invoke a recovered dispatched or uncertain action.

## MCP proxy: `zanii.mcp_proxy` (`pip install "zanii[mcp]"`)
```python
from zanii.mcp_proxy import TwoWayBridge, create_zanii_proxy, create_multi_server_proxy
proxy = create_zanii_proxy(upstream_session, zanii)   # upstream = connected mcp ClientSession
# two-way (opt-in): forward + receipt the server's sampling / elicitation / roots requests
bridge = TwoWayBridge(zanii)
#   ClientSession(read, write, **bridge.callbacks()) ; create_zanii_proxy(upstream, zanii, bridge=bridge)
# several upstreams behind one proxy: tools named <server>__<name>, recorded mcp.<server>.<tool>
#   create_multi_server_proxy({"crm": crm_session, "docs": docs_session}, zanii)
# or run standalone over stdio:
#   python -m zanii.mcp_proxy -- npx some-mcp-server   (env ZANII_SERVER / ZANII_IDENTITY / ZANII_API_KEY)
```

## Notes
- `record()` syncs the chain head on first call, then batches; `wrap_tool` handles sync and async functions.
- `salted_payload_hash(p, "")` commits unsalted since 0.27.0 (as TypeScript); `None` still draws a random nonce.
- `sign_object` / `verify_signed_object` (top-level): the shared "this did:key signed this statement" block.
- `zanii.encoding.js_stringify` reproduces `JSON.stringify` byte for byte, for commitments the npm packages
  make that way. Verifiers of pre-0.26 Python records accept the old form and report `"legacy": True`.
- Parity helpers: `zanii.embed.claim_badge_svg`, `zanii.conformance.validate_integration_evidence`,
  `zanii.langchain.with_zanii_config(config, agent)`, `zanii.mcp_proxy.server_reliability(records)`.
