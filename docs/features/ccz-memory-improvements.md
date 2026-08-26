# CCZ Memory System Improvements

Plan to close gaps between CCZ and TencentDB Agent Memory (TAM).
Generated: 2026-08-25

## Priority 1: High Impact, Quick Wins

| # | Improvement | Files | Status |
|---|---|---|---|
| 1.1 | **Incremental CodeGraph** — watch file mtimes, only re-scan changed files | `src/services/CodeGraph/index.ts` | ✅ |
| 1.2 | **Enforce `maxEntries`** — dead code in `teamMemPaths.ts` | `src/memdir/teamMemPaths.ts` | ✅ |
| 1.3 | **Async skill I/O** — `readFileSync`/`readdirSync` → async | `src/commands/skill-promote/skillPromote.ts` | ✅ |
| 1.4 | **Persist CodeGraph index** — save to JSON, load on startup | `src/services/CodeGraph/index.ts` | ✅ |
| 1.5 | **Persist agent registry** — save to JSON, load on startup | `src/memdir/teamMemPaths.ts` | ✅ |

## Priority 2: Medium Impact, Medium Effort

| # | Improvement | Files | Status |
|---|---|---|---|
| 2.1 | **BM25 scoring** for wiki search — replace TF with BM25 | `src/services/MagicDocs/wikiIndex.ts` | ⬜ |
| 2.2 | **Incremental PageRank** — only recompute affected nodes on mutation | `src/services/MagicDocs/wikiIndex.ts` | ⬜ |
| 2.3 | **Skill usage tracking** — count how often skills are loaded | `skillPromote.ts` + frontmatter | ⬜ |
| 2.4 | **Impact analysis caller-count heuristic** — prefer symbols with more refs | `ImpactAnalysisTool.ts` | ⬜ |
| 2.5 | **Wiki freshness signal** — last-modified timestamps on index entries | `wikiIndex.ts` | ⬜ |

## Priority 3: Higher Impact, Larger Effort

| # | Improvement | Files | Status |
|---|---|---|---|
| 3.1 | **Mermaid canvas for short-term memory** — symbolic task state compression | New service | ⬜ |
| 3.2 | **L0→L3 memory layering** — conversations → atoms → scenarios → personas | `SessionMemory/` | ⬜ |
| 3.3 | **Skill auto-extraction** — post-sampling hook extracts skills from conversations | `skillLearning/` | ⬜ |
| 3.4 | **Agent loadouts UI** — web panel for managing agent memory bindings | New | ⬜ |

## What TAM Has vs What CCZ Has

| Capability | CCZ | TAM |
|---|---|---|
| Persistence | Filesystem (SKILL.md only) | DB-backed |
| Semantic/Embedding Search | No (regex + TF) | Yes (vector similarity) |
| Temporal Decay | No | Yes |
| Agent/User Awareness | 3-role ACL (in-memory) | Per-user personalization |
| Audit Trail | No | Yes |
| Incremental Updates | No (full rebuild) | Yes |
| Quality Scoring | 3 basic validators | Effectiveness tracking |
| Cross-repo Support | No | Yes |

## Design Decisions

- **Persistence format**: JSON files in `~/.zaniicode/` (same config home as CCZ)
- **CodeGraph cache**: `.zaniicode/codegraph-cache.json` — store symbols + mtimes
- **Agent registry**: `.zaniicode/agent-registry.json` — store agent configs
- **No new dependencies**: BM25 implemented with stdlib, persistence with `fs`
- **Backward-compatible**: all improvements degrade gracefully if cache files are missing
