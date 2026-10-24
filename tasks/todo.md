# ChatGPT subscription integration

## Build and npm publication

User explicitly requested publication and supplied a local npm-key file. Target is the existing `claude-code-zanii` package on `https://registry.npmjs.org/`; prepare the next minor version, 2.13.0, for the added subscription feature. Registry version availability and publisher access could not be verified: npm is offline, and automatic approval rejected authenticated registry access. No token was read or printed by that rejected command. Do not bypass this restriction.

- [x] Inspect package manifest, build/macros, publish workflow, installed tooling and current checks; Git history remains unavailable.
- [x] Plan build, focused checks, package-content verification and the configured npm upload; publication already authorized by the user.
- [x] Bump package version, rebuild and pack the exact release artifact; confirm entrypoints, metadata and credential exclusion.
- [x] Evaluate local publication handoff. A helper's synthetic test was blocked by Windows ExecutionPolicy; the unverified helper/test were removed. Do not change policy or try an alternate credential-access method; provide standard npm login/publish commands instead.
- [x] Verify package smoke, regression/typecheck/lint status and record artifact hashes/publication status.
- [ ] Publish and verify the remote package. Blocked in this session by automatic approval and network restrictions; do not mark complete without registry confirmation.

Release preparation review: `artifacts/claude-code-zanii-2.13.0.tgz`, 25,591,712 bytes, 1,327 files. SHA-256 `636a2e1881dfb327588f8ba2a12dca8fdef2571257cb1b5234c42b642b01fbbb`; full npm integrity and content checks are in `tasks/verification/publish-artifact-check.json`. Build, 249 focused tests, strict typecheck, lint, lock validation and packed entrypoint/help smoke passed. This is a package-layout smoke using the workspace's dependency installation, not a clean online installation or live account test. A limited token-pattern check found no matches; it does not replace the outstanding dedicated secrets/security scans.

Publication preparation fixed one real bundle dependency defect: declare the already-locked `node-fetch@3.3.2` as a production dependency and align the stale lock root name. The bundle scanner now has one remaining optional keyring import error plus two Bun FFI warnings; reviewed keyring failures fall back to the encrypted file vault. The checker was not marked passing or suppressed. Included usage/readiness docs and updated the README release note. Generated artifacts/npm cache are ignored by Git. No package was uploaded, no Git commit/push was made, and the supplied real npm key was not read or displayed.

## Direct account sign-in follow-up

The existing UI, OAuth service and provider settings are the reference patterns. The stack remains Bun, Commander, TypeScript and the existing protected credential store; no dependency is added. Git history remains unavailable in this extracted checkout.

- [x] Review `src/main.tsx`, `src/cli/handlers/auth.ts`, `src/components/ConsoleOAuthFlow.tsx`, provider settings and browser helper.
- [x] Plan the direct `auth login --chatgpt` command, existing-policy enforcement, cancellation and account-neutral consent; user authorized planning and building.
- [x] Add `src/cli/handlers/chatgptLogin.ts` and its tests; wire `src/main.tsx` and `src/cli/handlers/auth.ts`.
- [x] Fix reviewed activation precedence in both login paths with `chatgptActivation.ts`; respect host-managed routing and confirm the effective saved mode.
- [x] Give the direct login flow signal ownership so existing startup/shutdown handlers cannot preempt cancellation cleanup; test dispatch behavior.
- [x] Include CLI regressions in `package.json`; document the command and account eligibility in the feature guide and change inventory.
- [x] Self-review, focused regression suite, typecheck, lint and rebuild; update verification and readiness evidence.
- [ ] Complete browser consent and live inference on the account owner's machine. No credentials should be sent in chat.

This follow-up adds one CLI entry to the existing local OAuth flow. Policy and conflicting-provider flags must be checked before opening the browser. Only a validated grant with plan-use permission and successful catalog discovery may select subscription mode. Ctrl+C must close the loopback listener and leave provider settings unchanged. No plan-name check, automatic inference, API billing fallback or policy bypass is added. Files: the new handler/test, the two command wiring files, package test script, feature/change/verification/readiness docs and task records. Verification covers success, permission denial, flags, managed policy, cancellation and failed catalog/settings persistence.

Review expanded the necessary file list: shared `src/services/api/openai/chatgptActivation.ts`, its two callers (the new CLI handler and `ConsoleOAuthFlow.tsx`), a light `src/utils/chatgptLoginSignals.ts` ownership module, `src/utils/gracefulShutdown.ts` and signal dispatch regressions. Higher-priority settings and host-managed routing must not be bypassed. Existing global signal handlers must yield only while direct login owns cancellation.

Follow-up review: `bun run test:chatgpt` passes **249 tests, 931 assertions across 16 files**; full strict typecheck, repository lint and primary build pass. Built `auth login --help` exposes `--chatgpt`. The 41 added regressions cover CLI consent, policy, effective selection, host routing and signal dispatch. No live account was connected. The earlier full-suite failures and nine readiness gaps remain open; they were not relabeled as passing or rerun without a relevant fix.

Status: the approved local, single-account integration is implemented and built. Focused regression checks pass; live-account acceptance and the documented release gaps remain open.

- [x] Inspect existing login, auth, provider routing, Responses adapter, tool permissions, models, usage, persistence and tests.
- [x] Research current official Sign in with ChatGPT and compare native integration with Codex app-server/SDK/ACP options.
- [x] Record findings and the proposed file inventory in `reports/ChatGPT subscription integration plan.md`.
- [x] Choose migration of the existing native OpenAI auth-mode route; defer a second agent runtime and Codex session imports.
- [x] Obtain implementation approval for the reviewed plan.
- [x] Prove app-owned signed-identity sign-in, model discovery and a completed text/tool/final-answer conversation against deterministic external-service fixtures.
- [ ] Verify real account/workspace/region eligibility and completed live subscription inference after user browser consent.
- [x] Prove namespaced function mapping and opaque reasoning retention through tool rounds, real normalization/microcompaction and transcript reload; bind state to account/provider/model and reject partial response replay.
- [x] Implement app-owned OAuth registration, signed identity and granted-scope validation, protected atomic credentials, serialized refresh, cancellation and reliable logout.
- [x] Verify eight independent CLI processes refresh the same synthetic account once and retain registration while logout clears tokens.
- [x] Migrate both main and auxiliary inference; validate terminal states, preserve native items, sanitize structured errors and prevent silent paid fallback.
- [x] Update login/status/model discovery and subscription usage labels; retain API-key behavior and prevent legacy 1M suffixes overriding native limits.
- [x] Add focused auth, stream, permission, persistence, context and billing regressions using shared mocks and temporary fixtures.
- [x] Repair installation layout and duplicate React identities; remove dangling absent optional feature registrations and restore missing safety/search/export helpers required for building the existing CLI.
- [x] Run focused tests, typecheck, lint and Bun build successfully; exercise broad tests and the Vite alternative and record environment/source blockers separately.
- [ ] Complete Windows manual sign-in, tool approval/denial, cancellation, concurrent refresh, restart/resume, provider switching and logout acceptance.
- [x] Write operating instructions, architecture/threat model and verification records.
- [ ] Clear or explicitly accept every outstanding readiness GAP before shipping; no release or remote push performed.

## Review

The native provider now uses app-owned Sign in with ChatGPT and the fixed public Responses endpoint. It preserves the existing permission-aware tool loop and stores opaque state once per assistant response. Real normalization, JSON reload and microcompaction tests verify replay; partial edited responses fail closed. One app-owned account/workspace registration is supported. Codex session imports and multi-account management remain outside this milestone.

`bun run test:chatgpt`: **208 pass, 0 fail, 602 assertions** across 14 files. `bun run typecheck`, `bun run lint` and `bun run build` exit 0. Rebuilt Bun and Node entrypoints report 2.12.0; built help loads. Local parser sweep completes 10,210 synthetic streams with zero errors: p99 107.96 ms at 128 concurrent streams, first measured 250 ms budget breach at 256. Independent-process refresh proof observes one refresh across eight overlapping workers.

The complete isolated repository suite exits 1: **6,062 pass, 60 fail, 5 errors** across 459 files. Failures include blocked subprocess wrappers, Windows named-pipe refusal/probe behavior, a temporary-directory fixture, git-context checks, timeouts and search-adapter tests. They are not all proven pre-existing because no pristine full-suite baseline or Git history exists. The focused subscription checks pass separately. Vite encounters managed-environment subprocess restrictions. Built auth-status smoke is blocked before its handler by the existing Windows MDM registry subprocess requirement. Synthetic PowerShell DPAPI round-trip passes, but actual Bun-to-DPAPI execution and real account sign-in/inference/revocation remain unverified. No personal credentials were inspected or membership usage consumed.

See `docs/features/chatgpt-subscription.md`, `docs/chatgpt-subscription-design.md`, `docs/chatgpt-subscription-verification.md`, `docs/readiness-report.md` and `tasks/verification/` for current evidence and the release decision. Git history is unavailable because `.git` is absent. No commit, push or deployment was performed.
