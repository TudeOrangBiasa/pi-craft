# pi-craft

This is a config for Pi (`pi-coding-agent` by earendil-works). It is tested. It contains owned extensions, vendored packages, guidance rules, agents, and a system prompt append. It installs into any Pi home.

## Use

```bash
bun install
bun run install   # copies into ~/.pi/agent (respects PI_CODING_AGENT_DIR), merges settings
```

Restart Pi to load the new files.

`installer/roster.ts` lists the packages. It lists 11 core packages. `web` is the only opt-in package. The installer installs these packages. It also installs the owned extensions (`omfg`, `bash-interceptor`, `governor`, `goal`). It writes what it installs to a manifest file. On the next run, it removes entries that are no longer in the roster. It does not touch packages that you install. It does not touch your settings entries. It skips opt-ins unless settings enable them. You can also enable an opt-in with `bun run install -- --with web`. A second run changes nothing.

## Layout

- `extensions/omfg`, `extensions/bash-interceptor`, `extensions/governor`, `extensions/goal`. These are owned extensions. They are tested with `bun run check`.
- `extensions/<name>`. These are vendored packages. See `extensions/REGISTRY.md`. LICENSE files retain original copyright.
- `guidance/`. These are TypeScript, Go, and Rust rules. The installer injects them automatically.
- `installer/`. This is the roster, the manifest code, and the tests.
- `agents/`, `prompt/APPEND_SYSTEM.md`. These are reviewer agents and the system-prompt append.
- `CHANGELOG.md`. It lists changes per release and upgrade steps.

## Goal mode

Use `/goal <condition>` to start a goal. Pi then takes turns without your input. It stops when the condition is true. It also stops on a real blocker. It also stops when the budget ends. `goal_complete` does not end the goal alone. It starts a verifier. The verifier is a new subagent. It has no write tools. It can only read. The goal ends when the verifier returns `PASS`. See `docs/adr/0010-goal-mode.md` and `docs/adr/0011-goal-verifier-gate.md`.

## Develop

```bash
bun install                        # root devDeps (oxfmt, oxlint, types)
bun install --cwd extensions/subagents   # nested suite peerDeps (@earendil-works/*)
bun install --cwd extensions/goal        # nested suite dep (typebox)
bun run check     # oxfmt + oxlint type-check + tests (owned + goal + installer + subagents)
```

- Rules: `CODING_STANDARDS.md`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`. Issues: GitHub issues.
