# Production readiness report

## CCZ 2.14.9: Kimi region release review (2026-10-30)

Base: `477658214d4f43c78703e297ba004cc70bf51d90`; the earlier report below
is preserved as it exists at that commit. Scope: pending Kimi region changes,
their CLI wiring, regression coverage, documentation, and the npm artifact.
No service, database, queue, or inference parser was added or changed.

Architecture: `--kimi-region` / `KIMI_REGION` selects a fixed OAuth host;
the encrypted credential stores the region; inference and refresh use that saved
region even if the environment subsequently changes. Old credentials use `cn`.
Scaling remains one OS user and a shared credential file, protected by the
existing cross-process lease. External Kimi availability and the local OS account
remain failure domains. There is no hosted-service availability promise.

Threat model: untrusted CLI/environment values, device authorization responses,
verification URLs, and stored JSON cross trust boundaries. Region values are
allowlisted; credential writes validate the complete record; authentication uses
fixed HTTPS hosts with redirects rejected. Verification URLs must be HTTPS under
`kimi.com` or `kimi.ai`. Spoofed verification hosts and cancellation are covered
by tests. Access/refresh tokens are sensitive; region is not an account identity.
Tokens are never included in the release logs. Local file read and OS credential
protection permissions are required. This review uses synthetic credentials and
does not establish live provider admission or remote revocation.

Evidence directory: `tasks/verification/release-2.14.9/`.
Focused run: **63 passed, zero failed, 120 assertions** (`kimi-tests.log`).
TypeScript passed (`typecheck.log`); changed-file Biome checks and source lint
passed (`source-lint.log`, 2,474 files). Whole-repository lint exited zero but
reported an invalid-UTF-8 diagnostic for an older untracked verification file;
the scoped source check has no such diagnostic. The build produced 1,330 output
files (`build.log`). The exact tarball passed metadata, path, supplied-token
exclusion and executable smoke checks (`package-check.json`).
The full isolated suite result is pending; do not interpret the scoped passes
as a full-suite pass.

Dependency audit: `bun audit --json` completed with findings (`audit.json`):
47 packages, 242 advisory entries (24 low, 126 moderate, 90 high, two critical).
These are raw audit entries, not 242 individually confirmed reachable exploits.
The critical entries name `proxy-addr` 2.0.7 (IP trust subnet handling) and
`shell-quote` 1.8.3 (newline handling in operator objects). Both versions and the
dependency manifest were already present at the base commit; no dependencies
were changed in this patch. Reachability and safe upgrades have not been
established. The release must not be described as vulnerability-free.

All 47 rows were evaluated for this scoped delta. Unchanged service/data/parser
rows retain the prior evidence and limitations below, as stored at the base
commit; none of its synthetic capacity numbers are Kimi capacity measurements.
Rows touching authentication (2, 3, 4, 21, 42), region configuration and local
credential lifecycle were reviewed again. Result: **18 PASS / 21 N/A / 8 GAP**.

| # | Status | Delta evidence or inherited applicability |
|---|---|---|
| 1 | PASS | Local-user scaling and failure domains described above; no hosted tier added. |
| 2 | PASS | `kimiAuth.ts` device/token schemas and encrypted storage; region login and refresh tests; password/MFA delegated to Kimi. Live acceptance remains row 4. |
| 3 | PASS | `kimiLogin.ts` and `activateKimiSubscription` preserve managed-policy/host restrictions; region selection grants no resource privileges. |
| 4 | GAP | Synthetic expiry/rotation tests pass; real consent, inference and remote revocation remain unverified. |
| 5 | N/A | No inbound product API or collection endpoint. |
| 6 | N/A | No public listener or shared subscription proxy; Kimi enforces its own quota. |
| 7 | PASS | Invalid-region test rejects before network access; strict stored-region schema; built CLI rejects region without Kimi mode. |
| 8 | PASS | Schema-validated device/token responses and bounded readJSON; verification-host regression passes. Inference output path unchanged. |
| 9 | GAP | Exact supplied token and sensitive-path archive scans pass; dedicated repository/history secret scanner unavailable. |
| 10 | PASS | Actual Windows DPAPI save/read/refresh operations pass in the focused suite; fixed HTTPS OAuth hosts. |
| 11 | N/A | No database. |
| 12 | N/A | No database growth or partitioning. |
| 13 | PASS | Existing model-cache policy unchanged; region does not introduce a cache. |
| 14 | N/A | Interactive CLI operations, no durable queue. |
| 15 | PASS | Existing proper-lockfile lease (60-second stale, 10-second update, bounded acquisition) retained; concurrent refresh test passes. |
| 16 | N/A | No payment/order/webhook writes or automatic inference replay. |
| 17 | N/A | One credential document, atomically replaced; no multi-record transaction. |
| 18 | PASS | Three concurrent global refresh requests perform exactly one rotation and preserve the saved region. |
| 19 | PASS | KimiAuthError classification retained; invalid region and cancellation fail before outbound calls. |
| 20 | GAP | Terminal diagnostics exist; uniform structured authentication correlation logs remain absent. |
| 21 | N/A | No shared administration, regulated operation, or role hierarchy added. |
| 22 | N/A | No deployed endpoint fleet. |
| 23 | N/A | No supervised service or load balancer. |
| 24 | N/A | No owned production service or on-call routing. |
| 25 | N/A | No owned distributed topology introduced. |
| 26 | PASS | Prior measured parser envelope retained; region lookup does not change the parser. |
| 27 | PASS | Prior synthetic parser load evidence retained, with its recorded limits. No load was sent to Kimi. |
| 28 | N/A | User-operated local process with the prior measured local headroom; no replica controller. |
| 29 | N/A | No served web assets or cacheable public routes. |
| 30 | N/A | No upload or object-storage service. Credentials intentionally belong to the local OS account. |
| 31 | N/A | No broker/webhook delivery. |
| 32 | PASS | Existing bounded refresh retry retained; device polling respects authorization_pending/slow_down. Original pending-poll regression passes. |
| 33 | N/A | No owned-service cascade or shared worker fleet. Required provider failures stop the individual CLI request. |
| 34 | PASS | Existing 30-second network timeout, bounded login deadline and lock retries retained; pre-request abort regression passes. |
| 35 | N/A | Kimi is the required dependency for the selected subscription; no billing/provider fallback is introduced. |
| 36 | N/A | Best-effort user-operated local CLI; process/provider interruption ends current work. |
| 37 | GAP | No timed local-state backup/restore rehearsal. |
| 38 | GAP | Build and archive smoke pass; full-suite result pending and rollback not rehearsed. |
| 39 | N/A | CLI replaced between invocations; no live request fleet or schema migration. |
| 40 | GAP | Audit completed with 242 advisory entries including two critical; upgrades/reachability not established. |
| 41 | GAP | Adversarial region tests and dependency audit ran; dedicated SAST and live account security acceptance remain missing. |
| 42 | PASS | Fixed HTTPS OAuth routing, redirect rejection and spoofed verification-host test; no SQL/cookie/browser-rendering surface introduced. |
| 43 | PASS | Region is the only new stored field; existing token protection/removal retained; archive credential exclusion verified. |
| 44 | N/A | One OS user's local account state; no shared tenant data store. |
| 45 | PASS | CLI > environment > historical cn default; saved region overrides later environment changes, verified by tests. |
| 46 | PASS | `docs/features/kimi-subscription.md` documents region selection, persistence and legacy compatibility. |
| 47 | GAP | Prior local parser ceiling is 128 synthetic concurrent streams, first tested breach 256; Kimi quota/cost/capacity and billing controls unmeasured. |

Release rollback: reinstall the previous published version with
`npm install -g claude-code-zanii@2.14.8`. This command is documented, not rehearsed;
the previous version cannot read new region-bearing credentials, so sign in again
after rollback rather than editing encrypted credential files.

Outstanding GAPs are rows 4, 9, 20, 37, 38, 40, 41 and 47. No risk acceptance
is inferred for new audit findings. This system is not cleared to ship until
the GAPs above are signed off or closed.

---

**System:** Zanii native ChatGPT subscription client. **Scope:** first full review of the local, single-account auth/inference path and the source/setup repairs needed to build it. **Date:** 2026-10-24. **Commit:** unavailable; this source snapshot has no `.git`. **Prior report:** none.

**Result:** `17 PASS / 21 N/A / 9 GAP`. The latest 249 scoped tests, strict typecheck, lint and primary build passed. The earlier broad isolated suite exited 1 with 6,062 passed, 60 failed and five errors; this is not release clearance. A PASS below means the scoped local behavior has concrete evidence, not that a real ChatGPT account or upstream capacity has been verified. Hosted-service requirements are N/A only where the local CLI has no corresponding service surface. See [the actual change inventory](chatgpt-subscription-changes.md) for application, baseline-repair and verification file scope.

**Measured local envelope:** 128 concurrent synthetic streams met the 250 ms p99 processing budget; the first tested breach was 256 streams. This is parser/adapter performance on this workstation, not OpenAI capacity or a subscription allowance.

**Direct-login delta (same date):** added `auth login --chatgpt`, shared activation and signal ownership. Re-verified rows 2, 3, 4, 7, 8, 13, 15, 18, 19, 21, 42, 43, 45 and 46 through the full focused suite, new CLI/activation/signal regressions and source review. Row 4 remains GAP; row 21 remains N/A because no privileged shared administration was added. Reviewed rows 9, 10, 20, 37, 38, 40, 41 and 47 retain their documented gaps; the delta does not supply missing live/scanner/recovery evidence. Other rows retain the full initial review below: no database, hosted service, adapter load path or deployment was changed. Git commit linkage is unavailable in this extracted checkout; prior artifacts are the initial `final-*` logs and recorded benchmark/concurrency files, and new artifacts are `direct-login-*` logs. The earlier full-suite failures were not rerun or declared fixed. Counts are unchanged.

## Stage artifacts

| Stage | Artifact and evidence |
|---|---|
| Architecture | `docs/chatgpt-subscription-design.md`: local data flow, process/concurrency boundary and failure domains. |
| Threat model | Same design document: callback spoofing, credential ownership, renewal/logout races, output validation, cross-account replay and bounded resources. |
| Implementation | App-owned `chatgptAuth.ts`/`chatgptStorage.ts`, public `responsesAdapter.ts`, account catalog, main/auxiliary routing, status/login/usage and durable message metadata. |
| Tests | Latest `bun run test:chatgpt` passed 249 tests across 16 direct isolated files with 931 assertions (`direct-login-chatgpt-tests.log`), including 41 added CLI/activation/signal checks. Prior broad `bun test --isolate` exited 1: 6,062 passed, 60 failed, five errors, 11,735 assertions across 459 files (`final-isolated-suite.log`). Failures are classified in the verification document and JSON evidence. |
| Load test | `scripts/benchmark-chatgpt-stream.ts`; `tasks/verification/chatgpt-parser-benchmark.json`: 10,210 streams, zero correctness errors, concurrency sweep 1–512. |
| Observability | Safe typed provider status/code/request IDs, terminal account/usage status and local benchmark artifacts. Uniform structured auth logging remains a GAP. |
| Security review | Adversarial auth/stream tests; bounded source-pattern review; dedicated SAST/secrets tools unavailable and dependency audit connection refused. |
| Scalability review | Parser processing and allocation were the measured stress domain; account-scoped caching and actual independent-process refresh serialization were verified. No upstream load was generated. |
| Readiness report | Initial full review of all 47 rows plus the explicitly scoped direct-login delta above; unchanged measurements/evidence retain their original limits. |

## The 47 requirements

| # | Requirement | Status | Evidence or system-specific reason |
|---|---|---|---|
| 1 | Architecture and scalability | PASS | Local client rather than stateless hosted tier; one OS account owns config/transcripts. Process scaling and failure domains documented in `chatgpt-subscription-design.md`; measured parser envelope below. |
| 2 | Authentication | PASS | External IdP owns password/MFA. `chatgptAuth.ts:412` verifies signed identity, issuer, audience, expiry and nonce; auth tests cover invalid signatures/claims, callbacks and denied inference scope. Live admission is separately unverified in row 4. |
| 3 | Authorization / RBAC | PASS | No new role hierarchy. Direct plan scope is required before inference; complete local proposals still pass existing `query.ts:763` / `services/tools/toolExecution.ts:964` authorization. Tests reject missing scope and incomplete executable calls. |
| 4 | Session management | GAP | Local expiry, rotation, logout and no-reconnection behavior are tested, including late login/refresh generations. Live account consent, actual provider revocation and the complete Windows acceptance flow have not run. |
| 5 | API design | N/A | No product collection/mutation API is exposed. The sole temporary return URI is an internal loopback OAuth callback; inference consumes OpenAI's fixed `/v1` API. |
| 6 | Rate limiting | N/A | No internet-facing inbound endpoint or shared account proxy exists. Callback access is loopback-only and state-bound; provider admission/quota failures stop client requests without switching billing. |
| 7 | Input validation | PASS | Strict stored-auth schemas, bounded callback state/parameters, model catalog schema and validated positive config limits. Auth/catalog/limits tests cover malformed inputs and invalid boundaries. |
| 8 | Output validation | PASS | SSE framing, event/stream/output limits and completed output validation in `responsesAdapter.ts`; tests reject malformed, oversized, incomplete and premature-EOF data before executable tool blocks. |
| 9 | Secrets management | GAP | App-owned credentials and fixed HTTPS destinations are implemented; limited literal-secret/unsafe-sink review found no matches. Dedicated secrets scan and Git-history scan are unavailable (`source-pattern-review.json`, no `.git`). |
| 10 | Encryption | GAP | HTTPS is fixed; Windows DPAPI primitives passed a synthetic PowerShell round trip and Unix files are owner-only. Actual Bun-to-PowerShell protection invocation is blocked by sandbox `EPERM`, so end-to-end native Windows storage is not verified. |
| 11 | Database architecture | N/A | This path uses one app-owned credential document and existing local transcripts, not a database. |
| 12 | Database scalability | N/A | No database, replicas, partitions or database row growth exist in this change. |
| 13 | Caching | PASS | Model cache has a five-minute TTL, validated account key and generation-based invalidation (`api/openai/chatgptModels.ts:10,39–45,128`); auth queue entries are removed after completion. |
| 14 | Queue / background jobs | N/A | Requests are interactive CLI operations and auxiliary queries, not durable job delivery. No queue consumer or asynchronous delivery promise is introduced. |
| 15 | Distributed locking | PASS | Actual `proper-lockfile` lease/heartbeat and bounded acquisition protect the shared credential file. Eight independent processes overlapped and performed exactly one rotation (`auth-concurrency-check.log`); registration survived logout while tokens were removed. |
| 16 | Idempotency | N/A | No payment/order/webhook write endpoint is introduced. The subscription wrapper does not automatically retry model or tool execution; code exchange is single-use and failed/incomplete streams never commit proposals. |
| 17 | Transaction management | N/A | One logical credential document is replaced atomically using a staged owner-protected file and rename; no multi-record database transaction exists. |
| 18 | Concurrency control | PASS | Per-file queue plus real cross-process lock; focused tests cover concurrent refresh, cancellation, logout ordering and stale login generation, and the independent-process experiment confirms one rotation. |
| 19 | Error handling | PASS | Auth/Responses errors use safe static summaries, bounded codes and request identifiers rather than raw response bodies. Tests inject credential-shaped diagnostic text and verify it is not displayed. |
| 20 | Logging | GAP | Safe user-facing diagnostics and provider request IDs exist, but uniform structured JSON auth lifecycle/correlation logging has not been implemented or verified. No clean logging claim is made. |
| 21 | Audit logging | N/A | No local admin roles, privileged shared-resource administration, regulated business operation or money transfer exists. OAuth consent and account policy are delegated to the user's IdP. |
| 22 | Observability | N/A | This is a local CLI client with no deployed endpoint fleet, resource dashboard or owned production service. Local diagnostics and measurements are recorded separately. |
| 23 | Health checks | N/A | No long-running supervised service, load balancer or readiness/liveness routing exists. |
| 24 | Monitoring and alerting | N/A | No deployed service or on-call routing is introduced; local failures surface to the terminal user. |
| 25 | Distributed tracing | N/A | There is no owned distributed-service or broker topology to instrument; requests go directly from one local client to an external provider. |
| 26 | Performance engineering | PASS | Actual p50/p95/p99, throughput, CPU and heap measurements exist for 10,210 parsed/adapted streams. Assumed local peak is 24; qualification is at least 48, covered at 64 streams. |
| 27 | Load testing | PASS | Committed deterministic script and actual sweep 1–512: zero correctness errors, p99 58.26 ms at 64, 107.96 ms at 128, first budget breach 390.37 ms at 256. Provider traffic is deliberately excluded. |
| 28 | Autoscaling | N/A | A fixed local client has no replica controller. Measured default-load headroom: 64-stream qualification exceeds twice the assumed peak; configurable subagent limits remain the user's local resource choice. |
| 29 | CDN / edge caching | N/A | The native terminal client serves no web assets or publicly cacheable authenticated content. |
| 30 | File / object storage | N/A | No upload/object-storage service is added. Credentials and transcripts intentionally belong to the local OS account, not an ephemeral multi-instance server filesystem. |
| 31 | Async communication | N/A | No broker, webhook receiver or durable cross-service message delivery is introduced. Streaming request/response validation is covered by rows 8, 19 and 34. |
| 32 | Retry strategy | PASS | Inference/tool calls are not automatically retried. Revocation has two bounded attempts with jitter; token/network failures preserve or clear state according to their tested classification. This avoids duplicating local side effects or changing billing. |
| 33 | Circuit breakers | N/A | A user-driven local client has no downstream owned-service cascade, request fleet or shared worker backlog. Its required provider failure terminates the individual request rather than propagating through an owned service graph. |
| 34 | Timeouts | PASS | Auth/JWKS calls: 15 s; browser flow: 10 min; Windows helper: 10 s; catalog: 10 s; inference validates its configured deadline. Cancellation, queued auth cancellation and reader cleanup have focused coverage. |
| 35 | Graceful degradation | N/A | The selected OpenAI auth/model provider is definitionally required for this request. Silent substitution with another account/provider/billing path is explicitly prohibited; local diagnostics remain available. |
| 36 | High availability | N/A | Best-effort user-operated local CLI; closing the process or losing the provider interrupts its current request. No hosted uptime contract or multi-zone service is offered. |
| 37 | Disaster recovery | GAP | Local credentials/registration and conversation state persist. JSON reload and reauthorization are tested, but no backup/restore rehearsal with measured RPO/RTO was performed; local ownership does not establish recovery evidence. |
| 38 | Deployment strategy | GAP | Final primary Bun build, strict typecheck and lint exited 0; both built Bun/Node entrypoints report 2.12.0 and built help exits 0. Broad isolated suite failed (6,062 pass / 60 fail / five errors); release rollback is unverified. Vite and built auth-status bootstrap encounter child-process `EPERM`. No publish/deploy occurred. |
| 39 | Zero / low-downtime deployment | N/A | A local CLI process is replaced between user invocations; there is no rolling traffic fleet or live schema migration. |
| 40 | Dependency management | GAP | Frozen lockfile and restored standard dependency layout are verified. `bun audit --json` failed with `ConnectionRefused`; vulnerability status is unknown. |
| 41 | Security testing | GAP | Manual adversarial review and focused auth/callback/output tests ran. Dedicated SAST/secrets tools are not installed, external audit is unavailable, and a live-provider security acceptance run has not been performed. |
| 42 | OWASP protections | PASS | Fixed HTTPS allowlists and redirect rejection prevent token forwarding; PKCE/state/nonce protect the local callback, callback headers constrain rendering, and untrusted tool output stays behind existing permission checks. Tests cover malformed callbacks, diagnostics and incomplete tool proposals. SQL/browser-cookie classes do not exist in this scoped client. |
| 43 | Privacy / data protection | PASS | Explicit local inventory/retention and deletion instructions in `chatgpt-subscription-verification.md`; logout removes app tokens, display-only telemetry excludes native encrypted state, and tests reject secret-bearing diagnostics. No central personal-data store or scheduled server retention job exists. |
| 44 | Multi-tenancy / isolation | N/A | One OS account owns one local app registration. No tenant database/shared subscription proxy exists; cross-account native-history replay is still rejected explicitly. |
| 45 | Configuration management | PASS | Existing provider selection retained; app-owned registration and stored state are schema-validated, inference timeout is range-checked and malformed subagent limits fall back safely. Setup and recovery commands are documented. |
| 46 | Documentation | PASS | Design, operating instructions, reproducible verification steps, data inventory, baseline repair record and this 47-row review exist in `docs/`. Actual manual/live limitations are explicit. |
| 47 | Cost / capacity management | GAP | Subscription/API cost labels and the local processing envelope are measured/tested. Real account allowance, optional credits/billing controls, upstream latency/capacity and a provider billing alert were not verified. |

## GAPs requiring closure or sign-off before release

| Row | Missing evidence/control | Owner and next action |
|---|---|---|
| 4 | Real account eligibility, complete Windows browser/tool/cancel/resume flow and actual remote revocation | Account owner and maintainer: run the documented manual acceptance without sharing tokens. |
| 10 | Actual Bun-to-DPAPI process boundary | Maintainer: run the installed CLI in an unrestricted Windows session; current sandbox returns `EPERM`. |
| 38 | Broad-suite failures, alternate build/bootstrap restrictions and release rollback | Maintainer: triage the recorded 60 failures/five errors, exercise restricted commands in a supported environment and rehearse rollback, or explicitly accept the relevant limitations. |
| 37 | Local credential/transcript backup and restore rehearsal | Maintainer/account owner: define recovery targets and perform a restore, or explicitly accept local-state loss; JSON round trips are not a disaster-recovery test. |
| 9 | Dedicated secret scan and unavailable Git history | Maintainer: scan the complete repository and its real history when available; a source-pattern check is not equivalent. |
| 40 | Dependency vulnerability scan | Maintainer: rerun the locked-tree audit with registry connectivity and triage findings. |
| 41 | Dedicated security scan and live security acceptance | Maintainer/security reviewer: run supported scanners and exercise the real account boundary. |
| 20 | Uniform structured auth correlation/lifecycle logging | Maintainer: define privacy-safe local diagnostic events or explicitly accept terminal-only lifecycle diagnostics. |
| 47 | Real plan/billing/capacity evidence | Account owner: verify allowed models, quota behavior and usage controls; do not treat parser throughput as provider throughput. |

No GAP has been signed off. This system is not cleared to ship until the GAPs above are signed off or closed.

## Measurements and limits

| Measurement | Recorded outcome |
|---|---|
| Runtime | Bun 1.3.14, local Windows workstation |
| Synthetic request volume | 10,210 streams; zero correctness failures |
| Assumed peak / qualification | 24 streams / at least 48; measured qualification level 64 |
| Qualification p50 / p95 / p99 | At 64 streams: 50.14 / 56.74 / 58.26 ms |
| Highest tested level within 250 ms p99 | 128 streams, p99 107.96 ms, 1,208.74 streams/s |
| First tested budget breach | 256 streams, p99 390.37 ms, 820.97 streams/s |
| Measured stress domain | Local parser/adapter processing and allocation; 3,266 ms CPU over 3,118 ms elapsed at 256 streams |
| Largest tested burst | 512 streams; p99 1,003.78 ms; zero correctness failures |
| Cross-process renewal | Eight overlapping independent processes, one rotation, no tokens after logout |
| Upstream account/model capacity | Not measured; no real auth/inference or quota exhaustion |
| Primary build / typecheck / lint | Latest direct commands all exited 0; Bun bundled 1,308 files, native assets and dual entrypoints; latest lint checked 3,369 files in 948 ms |
| Feature regression suite | 249 passed, zero failed, 931 assertions across 16 direct isolated files; `direct-login-chatgpt-tests.log` |
| Built startup smoke | Version smoke reports 2.12.0; built `auth login --help` exits 0 and exposes `--chatgpt`; prior auth-status bootstrap remains blocked by managed-policy registry child-process `EPERM` before the handler |
| Full suite | Exit 1: 6,062 passed, 60 failed, five errors, 11,735 assertions; 6,122 tests across 459 files in 943.42 s |
| Vite / built auth status | Alternative Vite build and managed-policy registry bootstrap both blocked by child-process `EPERM`; auth status was not a passing smoke |

Initial-state failures, standard dependency restoration and separate missing-source repairs are recorded in `chatgpt-subscription-verification.md`. Workspace-only synthetic credentials were cleaned up after verification; no personal auth files were inspected. CI uses `pipefail`, so this report does not repeat the earlier planning assumption that its test pipeline necessarily masks failures.

Native-state proof uses the real message normalizer and API normalizer, a JSON transcript round trip and actual microcompaction. The tests keep one metadata owner per split native response, preserve sibling visible content when remerging, reject edited/partial native representations and mismatched accounts/models, clear old tool-result content without dropping retained reasoning, and avoid resurrecting state removed by a summary. The mocked app-owned full-flow integration also covers signed callback login, catalog discovery, a completed namespaced function proposal, tool-result continuation, reloaded native state and logout. This does not replace a real account's resume/compaction acceptance run.
