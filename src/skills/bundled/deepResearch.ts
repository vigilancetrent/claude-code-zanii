import { WEB_SEARCH_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/WebSearchTool/prompt.js'
import { WORKFLOW_TOOL_NAME } from '@claude-code-best/workflow-engine'
import { registerBundledSkill } from '../bundledSkills.js'

const DEEP_RESEARCH_PROMPT = `# Deep research

Answer the question below with a sourced report. Run it as a dynamic workflow so the searches fan out in parallel.

## Question

$QUESTION

## Procedure

1. Break the question into 3–6 independent sub-questions (angles, time ranges, competing sources). Do not exceed 6.
2. Call the ${WORKFLOW_TOOL_NAME} tool once with this script shape (fill in the sub-questions):

\`\`\`js
export const meta = {
  name: 'deep-research',
  description: 'Fan out web searches, then synthesize',
  phases: [{ title: 'Search' }, { title: 'Synthesize' }],
}
const SUBQUESTIONS = [/* strings */]
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    facts: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, url: { type: 'string' }, date: { type: 'string' } }, required: ['claim', 'url'] } },
  },
  required: ['summary', 'facts'],
}
const results = await parallel(SUBQUESTIONS.map(q => () =>
  agent(\`Research with ${WEB_SEARCH_TOOL_NAME} and WebFetch: \${q}. Prefer primary sources and the last 12 months. Return only what the sources say.\`,
    { label: \`search:\${q.slice(0, 30)}\`, phase: 'Search', schema: FINDINGS_SCHEMA })
))
const synthesis = await agent(
  \`Write a report answering: $QUESTION\n\nFindings (JSON):\n\${JSON.stringify(results, null, 2)}\n\nStructure: 1) direct answer in 3 sentences, 2) key facts with inline [n] citations, 3) disagreements between sources, 4) open questions. End with a numbered Sources list of every URL used.\`,
  { label: 'synthesize', phase: 'Synthesize' },
)
return { report: synthesis }
\`\`\`

3. Print the report from the workflow result verbatim, then the Sources list.

If the ${WORKFLOW_TOOL_NAME} tool is unavailable, run the sub-question searches yourself with ${WEB_SEARCH_TOOL_NAME} (in parallel tool calls) and write the same report.
`

export function registerDeepResearchSkill(): void {
  registerBundledSkill({
    name: 'deep-research',
    description:
      'Fan out web searches across sub-questions in a workflow and synthesize a cited report.',
    userInvocable: true,
    argumentHint: '<question>',
    async getPromptForCommand(args) {
      const question = args?.trim()
      if (!question) {
        return [
          {
            type: 'text',
            text: 'Tell the user: usage is /deep-research <question>. Do nothing else.',
          },
        ]
      }
      return [
        {
          type: 'text',
          text: DEEP_RESEARCH_PROMPT.replaceAll('$QUESTION', question),
        },
      ]
    },
  })
}
