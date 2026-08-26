# Team Loadouts — Role-based Memory Filtering

> Filter which team memory entries each agent can see based on roles.

## What it does

TEAMMEM shares memory across all authenticated org members. Role-based loadouts add per-entry access control:

- Each entry can have `roles: ["frontend", "backend"]` metadata
- Each agent declares its role via `CCZ_TEAMMEM_AGENT_ROLE` env var
- During pull, entries are filtered — agents only see entries matching their role

## Setup

### 1. Tag entries with roles

In your team memory files, add YAML frontmatter:

```markdown
---
roles: [backend, infra]
agent: build-agent
---

# Deployment Runbook

Steps for deploying the API service...
```

The `meta` map in the server response stores per-entry role metadata:

```json
{
  "entries": { "runbook.md": "..." },
  "meta": {
    "runbook.md": { "roles": ["backend", "infra"], "agent": "build-agent" }
  }
}
```

### 2. Set agent role

```sh
# This agent only sees backend + infra entries
CCZ_TEAMMEM_AGENT_ROLE=backend ccz

# This agent sees everything (no role filter)
ccz
```

### 3. Verify

```sh
# Pull will only write entries matching the agent's role
ccz -p "list team memory files"
```

## Filtering rules

| Agent role | Entry roles | Visible? |
|---|---|---|
| (empty) | any | ✅ always — no filter |
| `backend` | (none) | ✅ — no roles = visible to all |
| `backend` | `[backend, infra]` | ✅ — match |
| `backend` | `[frontend]` | ❌ — no match |
| `frontend` | `[frontend]` | ✅ — match |

## Backward compatibility

- No `CCZ_TEAMMEM_AGENT_ROLE` set → sees everything (default)
- Entry has no `roles` metadata → visible to everyone
- Server doesn't send `meta` field → no filtering applied

## How it works

```
pullTeamMemory()
  → fetch from server → TeamMemoryData
  → extract entries + meta
  → filterEntriesByRole(entries, meta)
    → for each entry: check if agent role matches entry roles
  → writeRemoteEntriesToLocal(filteredEntries)
```

## Limitations

- TEAMMEM feature flag must be enabled (`FEATURE_TEAMMEM=1`)
- Roles are strings, not a predefined enum — flexibility but no validation
- No deny-list — only positive role matching
- Roles are per-entry, not per-file — same file can't have different roles for different sections
- Push always uploads all local entries (no role filtering on push)

## Files

| File | Purpose |
|---|---|
| `src/memdir/teamMemPaths.ts` | `getTeamMemAgentRole()`, `filterEntriesByRole()` |
| `src/services/teamMemorySync/types.ts` | `meta` field in `TeamMemoryContentSchema` |
| `src/services/teamMemorySync/index.ts` | Filtering during pull |
