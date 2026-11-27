# Changelog

Release notes for Claude Code Zanii (`ccz`). `/release-notes` reads this file.

## 2.14.19 - 2026-11-28

- `ccz work`: new optional setting `new_projects_in` in the worker config. An order for a project this PC has no folder for gets a new git repository in that folder, named from the project in safe letters, and the order is taken. Without the setting such orders are skipped, as before. A folder already there that is not a repository is never touched.

## 2.14.18 - 2026-11-28

- `ccz work`: an approval the server answers at once, from the owner's standing rules, is used straight away. Before, the worker waited a few seconds before noticing.

## 2.14.17 - 2026-11-26

- `ccz` keeps out of Claude Code's `~/.claude` folder. It no longer loads `~/.claude/CLAUDE.md` and rules, and no longer reads `~/.claude/settings.json` as project settings when started in your home folder. Its own folder is `~/.zaniicode`; put global instructions in `~/.zaniicode/CLAUDE.md`.
- Help text and built-in instructions name `~/.zaniicode` as the place for settings, skills, keybindings and other data.
- `ccz work`: a work order can carry a partner's request as background. The agent sees it as information, never as instructions; the partner's files are saved next to the working copy, not inside it; and an `ask_partner` tool sends a question to the owner first.

## 2.14.16 - 2026-11-26

- `ccz work`: a question from the agent now reaches the owner as a question, with nothing extra in the config. Before, it first arrived as an approval request.
- `ccz work`: a `git push` is refused on this PC without asking the owner, also when it is sent through the on-demand tool wrapper. Approval requests name the tool that really runs.
- Permission rules for an on-demand tool now apply when it runs through the wrapper. A rule such as `--allowedTools mcp__server__tool` used to be ignored there. An on-demand tool that allows itself now runs without a prompt, as it does when called directly.
- `ccz work --install` and `--uninstall` are removed. Use the `workAutoStart` setting to start the worker by itself.

## 2.14.15 - 2026-11-26

- `ccz work`: the agent can ask the owner a question (`ask_owner`) and send actions it is not allowed by itself for approval. A push is always refused.
- `ccz work <config> --install` makes the worker start at sign-in; `--uninstall` removes that. It needs `"key_file"` in the config.
- `"extra_args"` in the worker config adds flags to the agent command, for example to allow a test command.
- Known limit: a question from the agent first arrives as an approval request, so the owner is asked twice. To avoid that, start the worker with `ENABLE_SEARCH_EXTRA_TOOLS=0` and add `"extra_args": ["--allowedTools", "mcp__zanii__ask_owner"]`.
- Use either `--install` or the `workAutoStart` setting, not both: together they start two workers on one key.

## 2.14.14 - 2026-11-26

- The Zanii Calls worker can start by itself. Set `"workAutoStart": "<path to worker.json>"` in your user settings, and opening `ccz` starts `ccz work` in the background if it is not already running. It keeps running after the terminal closes.
- New commands `ccz work-status` and `ccz work-stop`.

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
