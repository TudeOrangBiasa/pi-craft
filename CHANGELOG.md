# Changelog

Newest entries are first. Each release lists changes and upgrade steps.

## Unreleased

### Removed

- The `rtk` optimizer package. Also removed: its Pi-side config fragment (`extensions/_pi-extensions/pi-rtk-optimizer`). Bash commands now run as typed. `governor` is the only output limit. See `docs/adr/0009-remove-rtk.md`.
- The `btw`, `preview`, and `advisor` packages. `/clear` answers side questions. `preview` used puppeteer-core. The goal verifier replaces second opinions.
- The non-Pi `safety-net` bundles (`dist/amp`, `dist/openclaw`, `dist/bin`). The Pi entry (`dist/pi`) stays.
- Subagent scheduling and `SubagentWorkflow`. Also removed: the `croner` dependency. Subagents now work as spawn, watch, steer, and resume. Goal mode handles long runs.
- Subagent `@handle` mentions. Also removed: cross-extension RPC (`subagents:rpc:*`), per-agent memory files, and nested subagents. Depth is 1. Lifecycle events (`subagents:created/started/completed/failed`) stay. Old frontmatter with `allowed_subagents` or `memory` still loads. It shows a warning. It does not show an error.

### Added

- A roster-driven installer (`installer/roster.ts`). It writes what it installs to a manifest file. It is a manifest that the installer owns. On the next run, it removes stale entries from `forks/` and `settings.json`. It does not touch packages that you install. It installs opt-ins (`web`) only when settings enable them. You can also use `--with web`. A second run changes nothing.
- Durable subagent runs. Run records are stored under the session state. After `/reload` or a killed process, interrupted runs are shown with a one-line notice. `get_subagent_result` returns `interrupted` and partial output. It never returns empty success. Resume continues in the same session file. Each agent has a `timeoutMs` limit (from frontmatter or from the settings default). A hung run ends as `timeout`.
- Goal mode (`/goal`, see `docs/adr/0010-goal-mode.md`). Each session has a maximum of one goal. Pi continues only when the agent is fully idle. The budget ends with one wrap-up turn. Then the loop stops. State is kept across `/reload` and `/resume`.
- A read-only verifier for `goal_complete` (see `docs/adr/0011-goal-verifier-gate.md`). The goal needs a `PASS` from a new read-only subagent. `FAIL` returns what is missing. `IMPOSSIBLE` blocks the goal. Two `FAIL` results in a row with no new evidence also block the goal. Set `PI_GOAL_VERIFY=0` to turn off verification. Without verification, the worker claim ends the goal.
- GitHub issues as the issue tracker. Docs point to issues. They do not point to `.scratch/`. Triage labels now include `risk:low`, `risk:medium`, and `risk:high`. `.scratch/` stays gitignored. It stores run logs.

### Upgrade

- The external `rtk` binary is now unused. Remove it manually (`cargo uninstall rtk` or delete it from `~/.local/bin`). The agent does not remove it.
- `installer/roster.ts` no longer lists `rtk`, `btw`, `preview`, or `advisor`. The next `bun run install` removes their fork dirs and their settings entries. It prints one `removed package: <name>` line for each. It also removes the live `extensions/pi-rtk-optimizer` dir.
- Old `schedulingEnabled` and `workflowsEnabled` keys are ignored. They do not cause errors. Old frontmatter with `allowed_subagents` or `memory` shows a warning.
