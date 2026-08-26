# Impact Analysis Tool

> See callers, callees, and blast radius before editing a function or method.

## What it does

Given a file position (line + character), `ImpactAnalysis` chains three LSP requests in one call:

1. **Prepare call hierarchy** — identifies the symbol at the position
2. **Incoming calls** — who calls this function/method
3. **Outgoing calls** — what this function/method calls
4. **Find references** — all files that reference this symbol

Returns a structured impact report with unique files affected.

## Usage

### Via ImpactAnalysisTool (automatic)

The model can call `ImpactAnalysis` directly:

```
ImpactAnalysis(filePath="src/auth/login.ts", line=42, character=10)
```

### Output

```
Impact analysis for handleLogin in src/auth/login.ts:
  3 caller(s) across 2 file(s)
  5 callee(s) across 3 file(s)
  12 reference(s) across 8 file(s)
  10 unique file(s) affected total

⚠️  Changing this symbol may break 3 call site(s).
```

### Fields

| Field | Type | Description |
|---|---|---|
| `symbolName` | string | Name of the symbol at the position |
| `callers` | `[{file, line, symbol}]` | Functions that call this symbol |
| `callees` | `[{file, line, symbol}]` | Functions this symbol calls |
| `references` | `string[]` | All files referencing this symbol |
| `uniqueFilesAffected` | number | Total blast radius |
| `summary` | string | Human-readable report with ⚠️/✅ indicator |

## Requirements

- `ENABLE_LSP_TOOL=1` env var (same as LSPTool)
- An LSP server configured for the file type (TypeScript, Python, etc.)
- File must be openable by the LSP server

## How it works

```
ImpactAnalysisTool.call(input)
  → open file in LSP
  → prepareCallHierarchy → get CallHierarchyItem
  → callHierarchy/incomingCalls → who calls it
  → callHierarchy/outgoingCalls → what it calls
  → textDocument/references → all references
  → deduplicate by file → compute blast radius
```

## When to use

Before editing any function, method, or class that might be called from other files. The tool tells you exactly what will break.

## Limitations

- Requires LSP server — no analysis for unsupported languages
- Single-level only — does not traverse transitive callers/callees
- No saved state — each call is independent
- Gated behind `ENABLE_LSP_TOOL=1`

## Files

| File | Purpose |
|---|---|
| `packages/builtin-tools/src/tools/ImpactAnalysisTool/` | Tool implementation |
| `src/tools.ts` | Registration (gated by `ENABLE_LSP_TOOL`) |
