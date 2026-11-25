# Zanii Mandate Agent Skill

A portable Agent Skill that makes an AI coding assistant a Zanii Mandate expert. Whenever a task
involves letting an AI agent act on someone's behalf within limits (permissions for agents, "may the
agent do X", revocation, human approval, or the Mandate SDKs), the assistant gets the right mental
model, the real API names and the rules it must follow, without re-explaining Mandate every session.

Progressive disclosure: `SKILL.md` (short, always considered) points to `reference/*.md` (loaded
only when a task needs the depth).

```
skills/zanii-mandate/
  SKILL.md                 # what a mandate is, packages, core flow, unknown outcomes, the rules
  reference/concepts.md    # constraints, approvals, conditions and providers, delegation, status,
                           # offline bundles, action vocabulary, policy packs, Zanii ID
  reference/typescript.md  # @zanii/mandate-sdk: client, errors, operation flow, verifyLocal
  reference/python.md      # zanii_mandate: client, errors, operation flow, FastAPI and Django
  reference/go-java.md     # the Go and Java SDKs (in the repository, not published)
  reference/patterns.md    # patterns and the gotchas models get wrong
```

## Install it

**Agents that support Agent Skills** (a folder with a `SKILL.md` that has `name` and `description`
frontmatter): copy `skills/zanii-mandate` into the agent's skills directory, either the
project-level one (this project only) or the personal one (every project). The agent discovers the
skill by its `description` and loads it when a task matches.

```sh
# example: copy into a project-level skills directory
mkdir -p <project>/<agent-skills-dir> && cp -r skills/zanii-mandate <project>/<agent-skills-dir>/
```

**Codex and agents that read `AGENTS.md`**: point the agent's instructions at
`skills/zanii-mandate/SKILL.md`, or paste its contents into the project's `AGENTS.md`, and link the
reference files for on-demand reading.

**Any other agent**: the skill is plain Markdown. Put `SKILL.md` in the model's context (system
prompt or tool docs) and load `reference/*.md` when needed.

## Keep it accurate

Written for the packages published on 30 October 2026: npm `@zanii/mandate-sdk`,
`@zanii/mandate-core`, `@zanii/mandate-policy-engine`, `@zanii/mandate-status-list` and
`@zanii/mandate-verify-core`, all 0.2.0, and PyPI `zanii-mandate-sdk` 0.2.0. The Go and Java SDKs
(0.2.0) and the middleware, gateway and MCP proxy packages are in the repository and not published.

When the SDKs, the HTTP API (`docs/api/openapi.yaml`, `apps/verify-api/src/routes/operations.js`) or
the shared reason codes (`tests/fixtures/reason-codes.json`) change, update `SKILL.md` and the
matching reference file in the same change. Run new snippets against a local development stack
(`npm run dev`), never a production deployment.

Maintained by Zanii AI.
