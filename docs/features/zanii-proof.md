# Zanii Proof of Action

CCB can record every tool call as a signed receipt in a public transparency log, so that "what did the agent actually do" has a cryptographic answer instead of a verbal one. The implementation is built on [Zanii](https://ledger.zanii.agency) — an append-only Merkle log with on-chain anchoring, verifiable entirely offline.

## What gets recorded

| Event | Receipt | Payload hash covers |
|---|---|---|
| CLI launch | `session_start` | CCB version |
| Each tool run | `tool_call` / `tool_error` | tool name + success flag |

Receipts contain **only hashes**. File contents, commands, and file paths never leave your machine — the ledger physically cannot leak them because it never receives them.

## First launch: zero-config provisioning

There is no account form. On first launch CCB:

1. Derives a hardware fingerprint — SMBIOS product UUID (set at manufacture, survives OS reinstalls), falling back to `/etc/machine-id` or NIC MACs
2. Signs up an org named `zaniicode-<fingerprint>` via `POST /v1/account/signup`
3. Issues a `zk_live_` ingest key against the admin key
4. Generates an Ed25519 agent identity (`did:key`) plus an owner-signed delegation cert scoped to `cli.*`
5. Stores everything under `~/.zaniicode/`:

```
~/.zaniicode/
├── zanii-account.json   # org id, admin key, zk_live_ ingest key  (mode 600)
├── zanii-agent.json     # agent keys + delegation certificate    (mode 600)
└── …                    # sessions, settings, cache — same layout as ~/.claude elsewhere
```

The API has no email/password login; the admin key plays that role and lives in the account file. If you wipe `~/.zaniicode/`, the next launch provisions a fresh suffixed org automatically.

## Startup banner

```
zanii ✓ proof verified · log #6156 · root 54874cc8
```

On every launch CCB records a `session_start` receipt, fetches its Merkle inclusion proof, and verifies it client-side: signature → delegation chain → scope → inclusion → signed tree head. If the network is down or no key is available, it degrades to a public read-only status line (`zanii ledger live · N receipts · root …`), or disappears entirely. Startup is never blocked by ledger state.

## Auditing

Everything reads are public:

- **One action**: open `/verify/<hash>` on the ledger for a human-readable proof page with QR
- **Full history**: `GET /v1/export/<agent DID>` returns a complete audit bundle; `verifyAuditBundle()` checks it offline
- **Live view**: [ledger.zanii.agency/dashboard](https://ledger.zanii.agency/dashboard) streams receipts as they land
- **This machine's agent DID**: printed in the banner area / stored in `~/.zaniicode/zanii-agent.json`

Verification needs only the public protocol — see [`@zanii/core`](https://www.npmjs.com/package/@zanii/core) (`fetchAndVerifyProof`, `verifyAuditBundle`). No trust in the server is required at any step.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `ZANII_PROOF` | on | `0` disables all ledger activity |
| `ZANII_API_KEY` | auto-provisioned | use your own ingest key instead |
| `ZANII_SERVER_URL` | `https://ledger.zanii.agency` | self-hosted or alternative log |

Build-time flag: `ZANII_PROOF` in [`scripts/defines.ts`](../../scripts/defines.ts).

## Implementation map

| Concern | Location |
|---|---|
| Identity, provisioning, receipts | [`src/utils/zaniiAgent.ts`](../../src/utils/zaniiAgent.ts) |
| Banner line | [`src/components/LogoV2/ZaniiLine.tsx`](../../src/components/LogoV2/ZaniiLine.tsx) |
| Tool-call hook (single canonical site) | [`src/services/tools/toolExecution.ts`](../../src/services/tools/toolExecution.ts) |
| Protocol skill for agents | [`skills/zanii/SKILL.md`](../../skills/zanii/SKILL.md) |

## Threat model notes

Honest limits worth knowing:

- The ledger proves *that* actions happened and under whose key — not that their content was benign
- Whoever controls `~/.zaniicode/zanii-account.json` controls writes for this machine; treat the file like a password vault entry (it is created mode 600)
- Anchoring to the chain happens periodically server-side; very recent receipts are Merkle-verified but not yet anchored
