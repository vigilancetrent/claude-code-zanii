# ChatGPT subscription verification

## npm release preparation: 2.13.0

The owner requested build and publication. The local release is prepared as `claude-code-zanii@2.13.0`, with the existing Bun/Node entrypoints and the account-sign-in operating/readiness documents included in the package. `node-fetch@3.3.2`, already present in the locked installation, is now declared as a production dependency because bundled Google clients import it at runtime. The lockfile's stale root package name was synchronized with the manifest; no installed dependency version was upgraded.

Remote publication has **not** been confirmed. The initial npm session reported `ENEEDAUTH` and offline-only registry data. The owner supplied a local npm-key path, but automatic approval rejected the authenticated registry check before it ran because sandbox approval is disabled. The key was not read or printed, and no alternate credential-access or upload method was attempted. A proposed local helper's synthetic test was also blocked by Windows ExecutionPolicy; the unverified helper and test were removed without changing that policy.

Artifact content, build, focused regression, typecheck, lint and smoke evidence are recorded in `tasks/verification/publish-*`. The package excludes `secrets/`, npm config, local credentials, `node_modules/` and verification/task data. The bundle scanner's remaining `@napi-rs/keyring` finding concerns the existing optional local-vault backend: `localVault/keychain.ts` converts import failure to `KeychainUnavailableError`, and `localVault/store.ts` selects encrypted-file fallback. The scanner is not reported as passing; Bun-only FFI warnings and the existing broad-suite/live-account gaps remain recorded.

To publish from a normal terminal with an authorized npm account, run `npm login --registry=https://registry.npmjs.org/`, then `npm publish ./artifacts/claude-code-zanii-2.13.0.tgz --ignore-scripts --access public --registry=https://registry.npmjs.org/`. The archive was already built, so publication must not rebuild it under credential-bearing lifecycle scripts. npm rejects an already-published version; remote version availability was not verified here. After upload, verify `npm view claude-code-zanii@2.13.0 version dist.integrity --registry=https://registry.npmjs.org/`. Do not send the token or browser callback in chat.

This verification concerns the local CLI subscription integration. It does not measure OpenAI service capacity, establish account eligibility, or authorize use of another application's stored credentials.

## Direct account sign-in follow-up (2026-10-24)

`auth login --chatgpt` now opens the existing app-owned OAuth flow directly. Any ChatGPT account may attempt it; Zanii does not gate on a plan name. OpenAI's granted plan permission and catalog/request admission remain authoritative. The CLI does not send inference during login.

Self-review found and fixed two integration defects: higher-priority settings could override user-level activation while success was reported, and earlier global SIGINT/shutdown handlers could preempt login cancellation. Both interactive and direct login now use the same effective-settings activation check, respect host-owned routing, and never overwrite higher-priority choices. Direct login owns signals until its cleanup finishes.

| Check | Result | Evidence |
|---|---|---|
| Focused suite | Exit 0: 249 pass, 0 fail, 931 assertions across 16 files | `tasks/verification/direct-login-chatgpt-tests.log` |
| Strict full typecheck | Exit 0, zero TypeScript errors | `tasks/verification/direct-login-typecheck.log` |
| Repository lint | Exit 0, 3,369 files | `tasks/verification/direct-login-lint.log` |
| Scoped Biome check | Exit 0 for seven handler/activation/signal/config files | Direct command; unchanged broad formatting conventions are not claimed clean. |
| Primary rebuild | Exit 0, 1,308 bundled files, native assets and both entrypoints | `tasks/verification/direct-login-build.log` |
| Built command help | Exit 0; exposes `--chatgpt` | `tasks/verification/direct-login-help.log` |
| Node entrypoint version | Exit 0: 2.12.0 | Direct `node dist/cli-node.js --version` smoke |

The 41 additional tests cover account-neutral authorization, managed/host routing constraints, missing permission, catalog and settings failures, arbitrary diagnostic redaction, activation precedence, cancellation and actual main SIGINT dispatch. They use synthetic tokens and mocked external/persistence boundaries; they are not live-account proof. Whole-file formatter checking of the existing large `main.tsx` reports formatting differences; it was not reformatted as part of this feature. Repository lint and new-file formatting pass.

The previous complete broad-suite run below remains the recorded broad result; no claim is made that its failures are fixed. Native Windows Bun-to-DPAPI, browser consent, live inference, revocation and quota controls still require the documented local acceptance. Run `bun dist/cli-bun.js auth login --chatgpt` in a normal local terminal, then start the CLI and send one small prompt. Do not send credentials or callback URLs in chat.

## Recorded initial state

These commands ran while implementation work was beginning; this source snapshot has no Git metadata, so this is an initial-state record rather than a clean-commit baseline.

| Command | Result | Evidence |
|---|---|---|
| `bun run typecheck` | Exit 2; 838 TypeScript diagnostics, including missing `bun-types` and existing telemetry type mismatches | `tasks/verification/initial-typecheck.log` |
| `bun run lint` | Exit 1 before linting: installed Windows Biome executable is missing | `tasks/verification/initial-lint.log` |
| `bun test src/services/api/openai/__tests__/responsesAdapter.test.ts src/utils/__tests__/sideQuery.chatgptAuth.test.ts src/utils/model/__tests__/chatgptModelRouting.test.ts` | 6 pass, 5 fail, 1 error; missing `gatewayHints.js` and installed `is-plain-obj` prevent relevant imports | `tasks/verification/initial-targeted-tests.log` |
| `bun audit --json` | Exit 1; audit service connection refused | `tasks/verification/dependency-audit.log` |

`gitleaks`, `trufflehog` and `semgrep` were not installed. A targeted source-pattern review is not a substitute for a successful secrets, dependency or static-analysis scan. Personal credential/session files are excluded from verification.

The dependency layout was repaired with `bun install --frozen-lockfile --ignore-scripts --backend=copyfile --linker=hoisted --force`: exit 0, 1,258 packages installed. This restored Windows Biome, transitive packages, Bun declarations and workspace junctions without changing dependency versions. Evidence is `tasks/verification/setup-hoisted-install.log`. The subsequent repository lint passed on 3,346 files (`post-hoisted-lint.log`); typecheck then exposed genuine missing source imports and test code still under construction.

The extracted Ink workspace also retained separate nested React 19.2.5 and reconciler 0.33.0 copies. `createRequire` proved different module identities despite equal versions. These two plain copied directories were moved, after source/target containment checks, to `tasks/verification/dependency-backups/node_modules/` and replaced with junctions to the same-version canonical root packages. No files were deleted. Module identities then matched, and the actual `AutofixProgress` static-render test passed in 22.57 ms. See `setup-react-dedup.log`, `react-identity-after.log` and `static-render-after-dedup.log`. The final Bun bundle was rebuilt after this runtime repair.

Separate baseline build repairs removed registrations for optional commands, skills and a librarian agent whose modules did not exist; removed nonexistent focus/repo-map prompt/view wiring; reused the existing XML escaper for untrusted subagent output; restored the transcript-search listener and documented subagent depth/concurrency limits; and restored real JSON export plus fenced rendered-text Markdown export. These absent optional features are not presented as implemented. The three new helper test files passed 7 tests and 36 assertions (`baseline-repair-tests.log`).

## Automated acceptance

The final readiness report records actual outcomes after implementation. Required focused cases cover signed identity and scope verification, callback state/nonce/PKCE, temporary versus terminal refresh errors, renewal/logout races, no Codex fallback, no paid API fallback, namespaced tools, terminal stream states, fragmented LF/CRLF/UTF-8 parsing, cancellation cleanup, account/model isolation, native reasoning replay and honest usage labels. Existing API-key mode must retain its behavior.

Run focused tests before the repository commands `bun run typecheck`, `bun run lint`, direct `bun test` and `bun run build`. `bun run build:vite` is also checked when release output requires it. Capture exit codes directly; a coverage artifact alone is not a passing test result. Missing dependencies and source files are recorded separately from regressions introduced by the subscription changes.

Final core results: `bun run test:chatgpt` passed 208 tests across 14 direct isolated files with 602 assertions; strict typecheck, repository lint (final rerun: 3,364 files in 873 ms) and the primary Bun build all exited 0. The build bundled 1,304 files and copied native assets/generated both entrypoints. Built Bun and Node `--version` both report 2.12.0, and built `--help` exits 0. The built auth-status smoke reaches an existing managed-policy registry subprocess that the sandbox rejects with `EPERM`, before the auth handler; managed-policy validation was not weakened to bypass it. `built-cli-auth-status.log` records this as not passing; its empty raw stdout is not a successful JSON result.

The alternative Vite build is blocked by sandbox child-process `EPERM`. The broad `bun test --isolate` run completed with exit 1: 6,062 passed, 60 failed, five errors and 11,735 assertions; 6,122 tests across 459 files in 943.42 seconds. The first default non-isolated attempt was interrupted after duplicate React identity caused invalid hooks; the completed result uses the repaired runtime and Bun isolation. Do not describe the whole repository suite as passing based on the 208 scoped tests.

| Broad failure group | Failed tests | Observed evidence |
|---|---:|---|
| Subprocess wrappers | 9 | `uv_spawn` / `EPERM`; includes three new cost/usage/auxiliary wrappers and six other wrapper/CLI cases. Their relevant direct subscription runners pass under `test:chatgpt`. |
| Fixture path | 1 | Ripgrep fixture attempts a denied write under `C:/tmp` when `TMPDIR` is unset. |
| Windows named pipes | 14 | UDS connection refusals, a false peer probe and consequent assertions; not proven to be sandbox restrictions. |
| Web-search adapter mock contract | 23 | Brave/Exa tests fail to import `getErrnoCode` from their incomplete mocked error utility. |
| Other assertions/timeouts | 13 | Git project context (2), skill-learning lifecycle/timing (4), team lifecycle (2), agent import (1), local memory (1), remote-trigger audit (2) and vault permissions (1). |

The five between-test errors comprise one managed-registry subprocess `EPERM`, two skill-learning missing temporary-file errors and two lifecycle/assertion errors. These are recorded separately from the 60 failed tests. Detailed filenames and log lines are in `tasks/verification/broad-suite-failure-classification.json`; raw evidence remains in `final-isolated-suite.log`. Many affected areas were not changed for subscription support, but there is no pristine full-suite baseline or Git history, so their failures are not all asserted to predate this task. No scoped feature logic failure was demonstrated in the 208 passing direct tests; broader regressions and platform behavior still require triage.

## Local performance experiment

Run `bun run scripts/benchmark-chatgpt-stream.ts`. The benchmark feeds synthetic fragmented Responses SSE into the actual parser and Anthropic-event adapter. Expected local peak is explicitly assumed to be 24 concurrent streams: the default 20 subagents, one interactive request and three auxiliary requests. Qualification therefore includes at least 48 streams; the measured 64-stream level covers this. It records stream completion, tool-call integrity, p50/p95/p99 local processing time, throughput, CPU time and observed heap changes. It does not sleep to simulate model latency or call a live model.

The recorded sweep completed 10,210 streams with zero correctness errors. Each stream included 13,312 decoded text bytes, a complete namespaced function call and opaque reasoning. The local target was p99 processing time no greater than 250 ms.

| Concurrent streams | p99 processing | Throughput | Result |
|---|---:|---:|---|
| 32 | 31.28 ms | 1,159.88 streams/s | Within budget |
| 64 | 58.26 ms | 1,177.11 streams/s | At least twice the assumed peak; within budget |
| 128 | 107.96 ms | 1,208.74 streams/s | Highest tested level within budget |
| 256 | 390.37 ms | 820.97 streams/s | First tested latency-budget breach |
| 512 | 1,003.78 ms | 568.87 streams/s | Correct output, processing exceeds budget |

The local processing limit appeared between 128 and 256 concurrent synthetic streams. At 256, process CPU time was 3,266 ms across 3,118 ms elapsed; this identifies local parser/adapter work and allocation as the measured stress domain, not remote model throughput. Results are workstation-specific, under shared-machine load, and do not establish a leak-free long-duration soak. Full percentiles, CPU/heap measurements and runtime version are in `tasks/verification/chatgpt-parser-benchmark.json`.

The maximum tested concurrency is not automatically a capacity ceiling. A sweep can identify a local processing-latency budget breach; upstream quotas, latency, billing and service saturation remain unmeasured. Mocked credentials and synthetic text contain no personal data.

## Independent-process refresh proof

`scripts/verify-chatgpt-concurrency.ts` uses the actual auth module, on-disk state and `proper-lockfile`. Only Windows protection and external IdP HTTP are mocked. Run its `setup` mode, start eight independent Bun processes in `refresh` mode concurrently, wait for all to exit, then run `check`, `logout` and `check-logout` modes in order. The check requires overlapping workers, exactly one refresh, retained registration and removed tokens after logout.

Eight independent processes overlapped in the recorded run, all exited 0, and only one token refresh occurred. The signed-ID-token verification used generated synthetic RSA keys; no key files or personal credentials were used. Logout retained the issued synthetic client mapping and removed its tokens. Evidence: `auth-concurrency-check.log`, `auth-concurrency-logout-check.log` and the worker logs under `tasks/verification/`. The final synthetic credential record was removed after asserting it had no tokens and that its resolved path remained inside this workspace. This verifies cross-process refresh serialization; live provider rotation/revocation and the Windows child-process protection boundary remain separate acceptance checks.

## Manual Windows acceptance

- Start a fresh local CLI and choose ChatGPT subscription sign-in. Complete browser consent in the user's account; confirm identity-only consent cannot enable inference.
- Complete one ordinary prompt and one harmless local tool round. Deny another tool and confirm it does not execute.
- Interrupt a streaming request and confirm the CLI returns control without accepting incomplete tool arguments.
- Exercise renewal while main and auxiliary requests overlap. Temporary network errors must not delete the registration or silently change billing mode.
- Resume a saved conversation after process restart. Verify retained reasoning/tool state, then switch account/provider/model and confirm opaque state is not replayed in an incompatible context.
- Log out. Confirm subsequent inference requires sign-in and does not reconnect through Codex files. Where remote revocation fails, confirm the CLI reports it honestly and local credentials are still removed.
- Inspect `/usage` and `/cost`: subscription usage must not be presented as API-key charges or fabricated quota percentages.

These live-account steps require user consent and were not performed during initial verification. No personal tokens were inspected and no quota was deliberately consumed or exhausted.

## Local data inventory

| Data | Purpose and retention |
|---|---|
| Installation host ID and issued client ID | Required app registration; retained after normal logout so reconnect uses the same registration. |
| Validated subject and optional email | Account binding and account display; retained with registration, never treated as an inference grant. |
| ID/access/refresh tokens and expiry/scope metadata | Authenticate permitted requests and rotate credentials; replaced atomically, removed on explicit logout or terminal refresh revocation. |
| Account-key hash and native reasoning/output items in messages | Bind resumable conversation state; retained under the existing local transcript lifecycle and excluded from display-only telemetry projections. |
| Model catalog | In-memory account-scoped cache, five-minute TTL; cleared on connection changes. |

The CLI has no central user-data database or background retention service. The OS account owner controls local config and transcripts. To remove retained registration information completely, first disconnect the app in ChatGPT settings, stop its CLI processes, then remove this app's `openai-chatgpt-auth.json` from its config directory. Do not remove Codex's auth file. Removing registration means the next app sign-in creates a new registration; normal `/logout` deliberately preserves it.
