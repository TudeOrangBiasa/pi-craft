# pi-craft

Tested Pi harness config (`pi-coding-agent` by earendil-works). Owned extensions, vendored packages, guidance rules, agents, and a system prompt append. It installs into any Pi home.

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
- `CHANGELOG.md`, what changed per release and how to upgrade.

## Goal mode

`/goal <condition>` starts an autonomous loop. Pi keeps taking turns until the condition holds, a real blocker appears, or the budget runs out. `goal_complete` does not end the goal on the worker's word. It starts a read-only verifier (a fresh subagent with no write tools) that must return `PASS`. See `docs/adr/0010-goal-mode.md` and `docs/adr/0011-goal-verifier-gate.md`.

## Develop

```bash
bun install                        # root devDeps (oxfmt, oxlint, types)
bun install --cwd extensions/subagents   # nested suite peerDeps (@earendil-works/*)
bun install --cwd extensions/goal        # nested suite dep (typebox)
bun run check     # oxfmt + oxlint type-check + tests (owned + goal + installer + subagents)
```

- Rules: `CODING_STANDARDS.md`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`. Issues: GitHub issues.
