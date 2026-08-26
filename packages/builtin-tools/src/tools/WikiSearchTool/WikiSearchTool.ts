import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  searchDocs,
  listIndexedDocs,
  getLinks,
  getBacklinks,
} from 'src/services/MagicDocs/wikiIndex.js'
import { WIKI_SEARCH_TOOL_NAME, DESCRIPTION } from './prompt.js'

// ── Schemas ──────────────────────────────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().describe('Search query (keywords to find in Magic Docs)'),
    action: z
      .enum(['search', 'list', 'links', 'backlinks'])
      .default('search')
      .describe(
        'Action: search (default), list (all docs), links (outbound from doc), backlinks (inbound to doc)',
      ),
    path: z
      .string()
      .optional()
      .describe('File path — required for "links" and "backlinks" actions'),
    limit: z
      .number()
      .int()
      .positive()
      .default(5)
      .describe('Max results to return'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    result: z.string(),
    resultCount: z.number().int(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// ── Tool ─────────────────────────────────────────────────────────────────────

export const WikiSearchTool = buildTool({
  name: WIKI_SEARCH_TOOL_NAME,
  searchHint: 'search across Magic Docs for documentation',
  maxResultSizeChars: 15_000,
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  requiresUserInteraction() {
    return false
  },
  userFacingName: () => 'Wiki Search',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async call(input: Input) {
    try {
      switch (input.action) {
        case 'list': {
          const docs = listIndexedDocs()
          if (docs.length === 0) {
            return {
              data: {
                result:
                  'No Magic Docs found in the workspace. Mark files with "# MAGIC DOC: [title]" to get started.',
                resultCount: 0,
              },
            }
          }
          const lines = docs.map(d => `  ${d.title} — ${d.path}`)
          return {
            data: {
              result: `Found ${docs.length} Magic Doc(s):\n${lines.join('\n')}`,
              resultCount: docs.length,
            },
          }
        }

        case 'links': {
          if (!input.path) {
            return {
              data: {
                result: 'Error: "path" is required for the "links" action.',
                resultCount: 0,
              },
            }
          }
          const links = getLinks(input.path)
          if (links.length === 0) {
            return {
              data: {
                result: `No outbound links found in ${input.path}`,
                resultCount: 0,
              },
            }
          }
          return {
            data: {
              result: `${input.path} links to ${links.length} file(s):\n  ${links.join('\n  ')}`,
              resultCount: links.length,
            },
          }
        }

        case 'backlinks': {
          if (!input.path) {
            return {
              data: {
                result: 'Error: "path" is required for the "backlinks" action.',
                resultCount: 0,
              },
            }
          }
          const backlinks = getBacklinks(input.path)
          if (backlinks.length === 0) {
            return {
              data: {
                result: `No docs link to ${input.path}`,
                resultCount: 0,
              },
            }
          }
          return {
            data: {
              result: `${backlinks.length} doc(s) link to ${input.path}:\n  ${backlinks.join('\n  ')}`,
              resultCount: backlinks.length,
            },
          }
        }

        case 'search':
        default: {
          if (!input.query.trim()) {
            return {
              data: {
                result: 'Error: query is required for search.',
                resultCount: 0,
              },
            }
          }
          const results = searchDocs(input.query, input.limit)
          if (results.length === 0) {
            return {
              data: {
                result: `No results found for "${input.query}"`,
                resultCount: 0,
              },
            }
          }
          const lines = results.map(
            (r, i) =>
              `${i + 1}. ${r.title} (${r.path}) — score ${r.score}\n   ${r.snippet}`,
          )
          return {
            data: {
              result: `Found ${results.length} result(s) for "${input.query}":\n${lines.join('\n')}`,
              resultCount: results.length,
            },
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      return {
        data: {
          result: `Error: ${err.message}`,
          resultCount: 0,
        },
      }
    }
  },
  renderToolUseMessage(input) {
    return `Wiki search: ${input.action}${input.query ? ` "${input.query}"` : ''}`
  },
  renderToolResultMessage(output) {
    return output.result
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.result,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
