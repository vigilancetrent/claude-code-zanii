---
name: verify
description: Verify a code change does what it should by launching and driving the app, not by reading it
---
# Verify

Prove the change works by *using* the software, not by reading it. Type checks and unit tests verify code; this skill verifies behaviour.

## Procedure

1. **Find the launch recipe.** If `.claude/skills/run/SKILL.md` exists in this project, follow it — it records exactly how to build, start and reach this app. If it does not exist, run `/run-skill-generator` first (or infer from `package.json` scripts, `Makefile`, `Dockerfile`, `pyproject.toml`, `README`) and say which you used.
2. **Start it** in the background (`run_in_background: true`), wait for the readiness line, and keep the process handle so you can stop it at the end.
3. **Drive the golden path** the change is about: CLI → run with representative args and check stdout/exit code; HTTP server → `curl` the endpoints and check bodies, not just status codes; UI → open it in the browser tools if available (mcp__claude-in-chrome__*, mcp__playwright__*), click through, read the console; library → import it from a fresh script as a consumer would.
4. **Try to break it**: empty / malformed / boundary inputs, a second run for idempotence, restart for persistence, one adjacent feature for regressions.
5. **Stop what you started.**

## Report

One short table: step · command · observed · verdict (PASS / FAIL / NOT VERIFIED). Every PASS must show the command and its actual output. If you could not run something, say NOT VERIFIED — never infer a PASS from reading code. Fix FAILs, then re-run only the failed steps.

See `examples/cli.md` and `examples/server.md` for the shape of a good run.
