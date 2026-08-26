export const IMPACT_ANALYSIS_TOOL_NAME = 'ImpactAnalysis' as const

export const DESCRIPTION = `Analyze the impact of changing a code symbol. Given a file and position, returns:
- Who calls this symbol (callers)
- What this symbol calls (callees)  
- All files that reference it (references)
- A summary of unique files affected (blast radius)

Use before editing functions/methods/classes to understand the blast radius.
Requires an LSP server configured for the file type.`
