# ChatGPT subscription change inventory

This inventory covers the approved implementation and the minimum repairs needed to build the extracted source snapshot. No dependency versions, remote branches, commits or deployments were changed. Generated build output is in `dist/`; command evidence is in `tasks/verification/`.

| Production file | Change |
|---|---|
| `src/cli/handlers/chatgptLogin.ts` | Direct browser login, managed-policy/flag checks, signal cancellation, validated subscription activation and account-neutral eligibility messaging. |
| `src/services/api/openai/chatgptActivation.ts`, `src/components/ConsoleOAuthFlow.tsx` | Shared activation with effective-settings verification, host-routing protection and fixed safe errors for both login paths. |
| `src/utils/chatgptLoginSignals.ts`, `src/utils/gracefulShutdown.ts`, `src/main.tsx` | Existing global shutdown dispatchers yield while direct account login owns cancellation. |
| `src/cli/handlers/auth.ts`, `src/main.tsx` | Wire `auth login --chatgpt` alongside existing Anthropic login choices. |
| `src/services/api/openai/chatgptAuth.ts` | App-owned registration, PKCE, signed identity, consent, atomic protected state, refresh locking, logout and safe recovery. |
| `src/services/api/openai/chatgptStorage.ts` | New current-user Windows DPAPI boundary; non-Windows owner-only file support remains in auth storage. |
| `src/services/api/openai/chatgptModels.ts` | New fixed public account catalog, validation, bounded responses, account/TTL invalidation and subscription model resolution. |
| `src/services/api/openai/responsesAdapter.ts` | Public transport, namespaced functions, bounded/cancellable SSE, completed-response commit point and native item replay. |
| `src/services/api/openai/index.ts` | Shared main-query integration, actual resolved-model usage, no subscription API-cost estimate and telemetry projection. |
| `src/utils/sideQuery.ts` | Auxiliary requests use the same app-owned auth and public transport. |
| `packages/@ant/model-provider/src/types/message.ts` | Typed optional native Responses metadata on assistant messages. |
| `src/utils/messages.ts` | Single durable metadata owner through normalization/merging; preserve state without duplicate replay. |
| `src/components/ConsoleOAuthFlow.tsx` | Browser consent, cancellation, catalog loading, first-use notice and explicit mode isolation. |
| `src/components/ModelPicker.tsx` | Account-specific choices/loading/errors, Manage usage link and no invented subscription 1M toggle. |
| `src/components/Settings/Usage.tsx` | Subscription usage presentation avoids Anthropic utilization calls and fabricated quota percentages. |
| `src/commands/login/getAuthStatus.ts` | Optional credential-free ChatGPT snapshot with provider-aware selection and plan permission. |
| `src/commands/login/AuthPlaneSummary.tsx` | Honest connection, grant and selected-mode display. |
| `src/commands/login/login.tsx` | Read app-owned local connection status for login and refreshes. |
| `src/commands/logout/logout.tsx` | Clear app tokens/catalog, show revocation warnings and retain billing selection to prevent fallback. |
| `src/cli/handlers/auth.ts` | Correct subscription CLI status and generic local logout feedback. |
| `src/utils/model/chatgptModels.ts` | Discovered catalog and model limits, compatibility defaults and common usage URL. |
| `src/utils/model/modelOptions.ts` | Use the account catalog instead of an asserted entitlement list; exclude another provider's cached choices. |
| `src/utils/context.ts` | Respect account limits before legacy 1M suffixes; use supplied output limits. |
| `src/cost-tracker.ts` | Distinguish measured subscription tokens from recorded API charges, retaining earlier real API costs. |
| `src/services/api/bootstrap.ts` | Discover subscription models with the selected app credential, never an API-key compatible host. |
| `src/utils/settings/types.ts` | Document subscription and API-key billing modes. |
| `src/utils/config.ts` | Persist acknowledgement of the first-use plan notice. |
| `package.json` | Add the reproducible `test:chatgpt` regression command; dependencies unchanged. |

The following baseline repairs remove dangling references to modules that were absent before this task. They do not advertise those absent optional features as implemented.

| File | Baseline repair |
|---|---|
| `src/services/api/claude.ts`, `src/services/api/gemini/index.ts`, `src/services/api/grok/index.ts`, `src/services/api/openai/index.ts` | Remove nonexistent optional `gatewayHints` imports/calls; preserve existing request identifiers. |
| `src/commands.ts` | Remove absent skill-doctor, list-agents, subtask, focus, autocompact, import and undo command registrations. |
| `src/skills/bundled/index.ts` | Remove absent prompt-audit/deep-research bundled registrations. |
| `packages/builtin-tools/src/tools/AgentTool/builtInAgents.ts` | Remove the absent librarian agent registration. |
| `packages/builtin-tools/src/tools/AgentTool/agentToolUtils.ts` | Reuse the existing XML escaper for untrusted subagent output. |
| `packages/builtin-tools/src/tools/AgentTool/limits.ts` | Restore validated documented depth/concurrency safety limits. |
| `src/constants/prompts.ts`, `src/screens/REPL.tsx` | Remove absent focus/repository-map prompt/view wiring. |
| `src/utils/transcriptSearchRequest.ts` | Restore the actual request/listener bridge used by prompt input and REPL search. |
| `src/utils/exportMarkdown.ts`, `src/commands/export/export.tsx` | Preserve JSON export and safe fenced Markdown output using the existing rendered transcript. |

| Tests and verification files | Coverage |
|---|---|
| `src/cli/handlers/__tests__/chatgptLogin.test.ts` | Direct account sign-in, flags/policy, permission denial, cancellation, error redaction and failed persistence/catalog regressions; included in `test:chatgpt`. |
| `src/utils/__tests__/chatgptLoginSignals.test.ts` | Actual earlier main dispatcher yields to a later cancellation listener; default and print-mode behavior remain covered. |
| `src/services/api/openai/__tests__/chatgptAuth.test.ts`, `chatgptModels.test.ts`, `responsesAdapter.test.ts`, `queryModelOpenAI.isolated.ts` | Auth, catalog, public protocol, terminal failures, isolation, native state, API-key regressions and actual-model usage. |
| `tests/integration/chatgpt-subscription.test.ts` | Full synthetic signed-identity sign-in through catalog, tool continuation, JSON reload and logout. |
| `src/utils/__tests__/messages.test.ts` | Actual normalization, merging and microcompaction with native state. |
| `src/utils/__tests__/sideQuery.chatgptAuth.test.ts`, `sideQuery.chatgptAuth.isolated.ts` | Auxiliary auth/provider regressions with isolated side-effect mocks. |
| `src/commands/login/__tests__/getAuthStatus.test.ts` | Connection versus permission and actual provider selection. |
| `src/__tests__/chatgptCost.test.ts`, `chatgptCost.isolated.ts` | Actual cost state, retained API charges and subscription context limits. |
| `src/components/Settings/__tests__/chatgptUsage.test.tsx`, `chatgptUsage.isolated.tsx` | Actual usage branch, management URL and no utilization/network calls. |
| `src/utils/__tests__/transcriptSearchRequest.test.ts`, `exportMarkdown.test.ts`, `packages/builtin-tools/src/tools/AgentTool/__tests__/limits.test.ts` | Restored shared behavior and safety guards. |
| `scripts/benchmark-chatgpt-stream.ts` | Deterministic parser/adapter load experiment with assertions. |
| `scripts/verify-chatgpt-concurrency.ts` | Independent-process credential rotation/logout proof using synthetic data. |

Design, operating instructions, readiness findings, measurements and task status are in `docs/chatgpt-subscription-design.md`, `docs/features/chatgpt-subscription.md`, `docs/chatgpt-subscription-verification.md`, `docs/readiness-report.md` and `tasks/todo.md`. The original research report now links to implementation results. Dependency installation repairs and same-version React deduplication are recorded separately from application changes in the verification document.
