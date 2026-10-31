# Changelog

Newest first. Each release lists what changed and how to upgrade.

## Unreleased

### Removed

- The `rtk` optimizer package and its Pi-side config fragment (`extensions/_pi-extensions/pi-rtk-optimizer`). Bash commands run verbatim now. `governor` is the only output bound. See `docs/adr/0009-remove-rtk.md`.
- The `btw`, `preview`, and `advisor` packages. Side questions live in `/clear`. `preview` pulled in puppeteer-core. Goal mode's verifier replaces second opinions.
- The non-Pi `safety-net` bundles (`dist/amp`, `dist/openclaw`, `dist/bin`). The Pi entry (`dist/pi`) stays.
- Subagent scheduling and `SubagentWorkflow` (plus the `croner` dependency). Subagents are spawn, watch, steer, resume now. Goal mode covers long-running orchestration.
- Subagent `@handle` mentions, cross-extension RPC (`subagents:rpc:*`), per-agent memory files, and nested subagents (depth fixed at 1). Lifecycle events (`subagents:created/started/completed/failed`) stay. Old `allowed_subagents` and `memory` frontmatter loads with a warning, not an error.

### Added

- Roster-driven installer (`installer/roster.ts`). It records what it deployed in an installer-owned manifest and removes stale entries from `forks/` and `settings.json` on re-run. User-installed packages stay untouched. Opt-ins (`web`) deploy only when settings enable them or with `--with web`. Re-running changes nothing.
- Durable subagent runs. Run records persist under the session state. After `/reload` or a killed process, interrupted runs surface with a one-line notice. `get_subagent_result` returns `interrupted` plus partial output, never empty success. Resume continues the same session file. Per-agent `timeoutMs` (frontmatter, settings default) ends hung runs as `timeout`.
- Goal mode (`/goal`, see `docs/adr/0010-goal-mode.md`). One goal per session, with continuation only when the agent is fully idle. The budget ends with one wrap-up turn, then the loop stops. State survives `/reload` and `/resume`.
- Read-only verifier gate for `goal_complete` (see `docs/adr/0011-goal-verifier-gate.md`). Completion needs a `PASS` from a fresh read-only subagent. `FAIL` feeds back what is missing. `IMPOSSIBLE` blocks the goal. Two consecutive `FAIL`s with no new evidence block instead of looping. Set `PI_GOAL_VERIFY=0` to disable; without verification the worker's claim completes the goal.
- Issue tracker moved to GitHub issues. Docs point at issues, not `.scratch/`. Triage labels include `risk:low`, `risk:medium`, `risk:high`. `.scratch/` stays gitignored for run logs.

### Upgrade

- The external `rtk` binary is now unused. Remove it by hand (`cargo uninstall rtk` or delete it from `~/.local/bin`). The agent never uninstalls it.
- `installer/roster.ts` no longer lists `rtk`, `btw`, `preview`, or `advisor`. On the next `bun run install`, the installer removes their fork dirs and settings entries (expected: one `removed package: <name>` line each). The live `extensions/pi-rtk-optimizer` dir is removed too.
- Old `schedulingEnabled` and `workflowsEnabled` settings keys are ignored, not errors. Old agent frontmatter with `allowed_subagents` or `memory` loads with a warning.
