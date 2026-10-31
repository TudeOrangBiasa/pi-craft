# pi-craft

Minimal, tested Pi (`pi-coding-agent` by earendil-works) harness config. Owned extensions, vendored packages, guidance rules, agents, and system prompt. It installs into any Pi home.

## Use

```bash
bun install
bun run install   # copies into ~/.pi/agent (respects PI_CODING_AGENT_DIR), merges settings
```

Restart Pi to load.

The roster in `installer/roster.ts` lists 11 core packages. `web` is the only opt-in. The installer also installs the owned extensions (`omfg`, `bash-interceptor`, `governor`, `goal`). It tracks what it installed in its own manifest file and removes stale entries on re-run. Packages you installed yourself and your settings entries stay untouched. The installer skips opt-ins unless settings already enable them or you pass `bun run install -- --with web`. Re-running changes nothing.

## Layout

- `extensions/omfg`, `extensions/bash-interceptor`, `extensions/governor`, `extensions/goal`, owned and tested (`bun run check`).
- `extensions/<name>`, vendored packages (see `extensions/REGISTRY.md`; LICENSE files retain original copyright).
- `guidance/`, auto-injected TypeScript, Go, and Rust rules.
- `installer/`, roster, manifest tracking, and tests.
- `agents/`, `prompt/APPEND_SYSTEM.md`, reviewer agents and the system-prompt append.

## Goal mode

`/goal <condition>` starts an autonomous loop. Pi keeps taking turns until the condition holds, a real blocker appears, or the budget runs out. `goal_complete` does not end the goal on the worker's word. It starts a read-only verifier (a fresh subagent with no write tools) that must return `PASS`. See `docs/adr/0010-goal-mode.md` and `docs/adr/0011-goal-verifier-gate.md`.

## Removed

The `rtk` optimizer is gone (see `docs/adr/0009-remove-rtk.md`). Bash commands run verbatim and `governor` is the only output bound. The external `rtk` binary is now unused. Remove it by hand if you want (`cargo uninstall rtk` or delete it from `~/.local/bin`); the agent never uninstalls it.

Also removed: the `btw`, `preview`, and `advisor` packages. Side questions live in `/clear`, preview pulled in puppeteer-core, and goal mode's verifier replaces second opinions. The non-Pi `safety-net` bundles are gone too (the Pi entry stays).

## Develop

```bash
bun install                        # root devDeps (oxfmt, oxlint, types)
bun install --cwd extensions/subagents   # nested suite peerDeps (@earendil-works/*)
bun install --cwd extensions/goal        # nested suite dep (typebox)
bun run check     # oxfmt + oxlint type-check + tests (owned + goal + installer + subagents)
```

- Rules: `CODING_STANDARDS.md`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`. Issues: GitHub issues.
