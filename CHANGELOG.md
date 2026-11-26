# Changelog

Release notes for Claude Code Zanii (`ccz`). `/release-notes` reads this file.

## 2.14.13 - 2026-11-26

- `/agents` opens the local agent manager on every sign-in. On a Claude sign-in it used to open the cloud scheduled-agents command.
- `/daemon start` starts the daemon as a separate background process and returns, instead of hanging the window.
- `/tui on` now takes effect on the next start by itself. No shell profile line is needed.
- `/ultrareview`, `/ultraplan`, `/teleport` and `/autofix-pr` are shown only on a Claude sign-in, the only place they can work.
- `/assistant` no longer claims to open a panel that does not exist.
- `/feedback` and `/bug` are hidden until there is a Zanii endpoint for reports. They used to send reports to Anthropic.
- `/release-notes` shows this changelog, not the upstream Claude Code one.
- HTML artifacts are opt-in: the artifact tool, `/artifacts` and `/use-artifacts` appear only after you set `CLAUDE_ARTIFACTS_URL` to a server you chose. Nothing is uploaded to a built-in server any more.
- Web search shows which server it uses when that is the community-run default. Change it with `/web-tools`.

## 2.14.12 - 2026-11-26

- New command `ccz work <config>`: takes work orders from a Zanii Calls server and does each one in a separate git worktree.

## 2.14.11 - 2026-11-26

- Live-tested on Anthropic: Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5 run multi-step tool tasks; subagents, auto mode and compaction work on Fable.
- Compaction on Claude 5 no longer asks the model to write out its reasoning.
- Entering or leaving a worktree no longer rebuilds the system prompt on Claude 5.

## 2.14.10 - 2026-11-26

- Claude 5 requests no longer fail when earlier turns were changed; the API drops the mismatched reasoning instead.
- Reasoning summaries are shown on Claude 5. Fable defaults to high effort. Fast mode is available on Fable 5.2.
- Task tools are available on Claude 5 again.
- A refused reply cancels its tool calls and ends the turn.
- The final recap is sized to the work, and the model is told not to stop while work is still owed.
- Forked subagents no longer commit on their own.

## 2.14.9 - 2026-11-25

- Claude 5 models: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5, and the `fable` alias.
- Signing in to Anthropic after ChatGPT or Kimi now switches the provider back.
- ChatGPT models report their real context window from startup.
- `/model`, `/usage` and `/status` show the right thing for each provider.
- Kimi: region choice for China or International.

## 2.14.8 - 2026-10-30

- Kimi Code subscription sign-in.

## 2.14.7 - 2026-10-26

- ChatGPT sign-in: tool calls work. They were being dropped.

## 2.14.6 - 2026-10-26

- ChatGPT sign-in: an interrupted reply no longer breaks the conversation.

## 2.14.5 - 2026-10-24

- ChatGPT sign-in: fixed "ChatGPT returned a non-streaming response".

## 2.14.4 - 2026-10-24

- ChatGPT subscription sign-in and model catalog, together with the 2.12 to 2.14.1 features.
