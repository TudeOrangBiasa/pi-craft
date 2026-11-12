# pi-craft

This is a config for Pi (`pi-coding-agent` by earendil-works). It is tested. It contains owned extensions, vendored packages, guidance rules, agents, and a system prompt append. It installs into any Pi home.

## Use

```bash
bun install
bun run install   # copies into ~/.pi/agent (respects PI_CODING_AGENT_DIR), merges settings
```

Restart Pi to load the new files.

`installer/roster.ts` lists the packages. It lists 7 core packages, all installed every run. It also installs the owned extensions (`bash-interceptor`, `governor`). It writes what it installs to a manifest file. On the next run, it removes entries that are no longer in the roster. It does not touch packages that you install. It does not touch your settings entries. A second run changes nothing.

## Layout

- `extensions/bash-interceptor`, `extensions/governor`. These are owned extensions. They are tested with `bun run check`.
- `extensions/<name>`. These are vendored packages. See `extensions/REGISTRY.md`. LICENSE files retain original copyright.
- `guidance/`. These are TypeScript, Go, and Rust rules. The installer injects them automatically.
- `installer/`. This is the roster, the manifest code, and the tests.
- `agents/`, `prompt/APPEND_SYSTEM.md`. These are reviewer agents and the system-prompt append.
- `CHANGELOG.md`. It lists changes per release and upgrade steps.

## Develop

```bash
bun install                        # root devDeps (oxfmt, oxlint, types)
bun install --cwd extensions/subagents   # nested suite peerDeps (@earendil-works/*)
bun run check     # oxfmt + oxlint type-check + tests (owned + installer + subagents)
```

- Rules: `CODING_STANDARDS.md`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`. Issues: GitHub issues.
