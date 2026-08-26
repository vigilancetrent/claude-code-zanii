# TAM Proxy Integration

> Zero-code path to team memory via [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) proxy.

## What is TAM?

TencentDB Agent Memory (TAM) provides a proxy server that speaks the Claude protocol. Point CCZ at it and you get team memory, session persistence, and context sharing — no code changes required.

## Setup

### 1. Deploy TAM proxy

Follow the [TAM quickstart](https://github.com/TencentCloud/TencentDB-Agent-Memory#quickstart):

```sh
git clone https://github.com/TencentCloud/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory
docker compose up -d
```

The proxy listens on `http://localhost:8080` by default.

### 2. Point CCZ at the proxy

```sh
# Via login
ccz
/login
# Select "Anthropic Compatible"
# Base URL: http://localhost:8080

# Or via env var
ANTHROPIC_BASE_URL=http://localhost:8080 ccz
```

### 3. Verify

```sh
ccz -p "say hello"
# Should get a response routed through the TAM proxy
```

## What you get

| Feature | Without TAM | With TAM proxy |
|---|---|---|
| Session memory | Local only | Shared across team |
| Context sharing | Manual (CLAUDE.md) | Automatic via proxy |
| Memory persistence | Per-machine | Per-org, synced |
| Code changes needed | — | Zero |

## How it works

```
CCZ CLI  →  TAM Proxy  →  Anthropic API
             ↓
        Team Memory DB
        (sessions, context, preferences)
```

The proxy intercepts requests, injects team context, stores session data, and forwards to the Anthropic API. CCZ sees a standard `/v1/messages` endpoint — no special integration.

## Limitations

- Requires TAM server running (self-hosted or managed)
- Adds ~50ms latency per request (proxy hop)
- Team memory scope is per TAM deployment, not per-repo (unlike TEAMMEM's git-scoped approach)
- No Zanii proof-of-action integration (TAM receipts are separate)

## When to use TAM vs TEAMMEM

| Use case | TAM proxy | TEAMMEM |
|---|---|---|
| Team of humans sharing context | ✅ | ✅ |
| Multi-agent role-based loadouts | ❌ | ✅ (Phase 3.2) |
| Zero-code setup | ✅ | ❌ (needs OAuth + git remote) |
| Self-hosted infrastructure | ✅ | ❌ (uses Anthropic API) |
| Zanii proof-of-action | ❌ | ✅ |

Both can run simultaneously — TAM for team context, TEAMMEM for git-scoped sharing, Zanii for audit trails.
