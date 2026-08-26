# Wiki-lite — Cross-link Search Across Magic Docs

> Built-in search across all Magic Docs with keyword matching, backlinks, and outbound link traversal.

## What it does

Magic Docs are auto-maintained markdown files marked with `# MAGIC DOC: [title]`. Wiki-lite adds:

1. **Cross-link detection** — extracts markdown links `[text](path)` from every Magic Doc and builds an adjacency graph
2. **Inverted search index** — tokenizes content into terms with TF scoring for keyword search
3. **Backlink navigation** — "which docs link to this one?"

All index state is in-memory, rebuilt each session from tracked docs. No persistence needed.

## Usage

### Via WikiSearchTool (automatic)

The model can call `WikiSearch` directly:

```
WikiSearch(query="authentication flow", action="search")
WikiSearch(action="list")
WikiSearch(action="links", path="docs/auth.md")
WikiSearch(action="backlinks", path="docs/auth.md")
```

### Actions

| Action | Description |
|---|---|
| `search` (default) | Keyword search across all indexed docs, ranked by TF score |
| `list` | List all tracked Magic Docs with titles |
| `links` | Show outbound links from a specific doc |
| `backlinks` | Show which docs link to a specific doc |

### Search results

Results include:
- File path
- Document title
- Relevance score (TF-weighted, title matches boosted 10x)
- Context snippet around the first matching term

## How it works

```
FileReadTool fires
  → detectMagicDocHeader(content)
    → if magic doc: registerMagicDoc + indexMagicDoc
      → extractLinks(content) → adjacency graph
      → extractTerms(content) → inverted index

WikiSearchTool.query()
  → searchDocs(query)
    → tokenize query → match against inverted index
    → score by TF + title boost
    → return top-N with context snippets
```

## Re-indexing

The index is rebuilt automatically when:
- A Magic Doc is first read (FileReadTool listener)
- A Magic Doc is updated by the background agent (post-sampling hook)

No manual re-indexing needed.

## Limitations

- In-memory only — cleared on session restart
- No fuzzy matching — exact term match only
- No semantic search — keyword TF scoring, not embeddings
- Magic Docs must use `# MAGIC DOC: [title]` header to be indexed

## Files

| File | Purpose |
|---|---|
| `src/services/MagicDocs/wikiIndex.ts` | Index: link extraction, term tokenization, search |
| `src/services/MagicDocs/magicDocs.ts` | Hook: index on read, re-index on update |
| `packages/builtin-tools/src/tools/WikiSearchTool/` | Tool: search, list, links, backlinks |
