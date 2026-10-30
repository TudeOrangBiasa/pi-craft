# pi-craft

Minimal, tested Pi (`pi-coding-agent` by earendil-works) harness config. Owned extensions, vendored packages, guidance rules, agents, and system prompt — installable into any Pi home.

## Use

```bash
bun install
bun run install   # copies into ~/.pi/agent (respects PI_CODING_AGENT_DIR), merges settings
```

Restart Pi to load.

## Layout

- `extensions/omfg`, `extensions/bash-interceptor`, `extensions/governor` — owned, tested (`bun run check`).
- `extensions/<name>` — vendored packages (see `extensions/REGISTRY.md`; LICENSE files retain original copyright).
- `guidance/` — 27 auto-injected guidance rules (TS + Go + Rust).
- `agents/`, `prompt/APPEND_SYSTEM.md` — reviewer agents and the system-prompt append.

## Removed: RTK

The `rtk` optimizer is gone (see `docs/adr/0009-remove-rtk.md`): bash commands run verbatim and `governor` is the only output bound. The external `rtk` binary is now unused — remove it by hand if you want (`cargo uninstall rtk` or delete it from `~/.local/bin`); the agent never uninstalls it.
## Develop

```bash
bun install                        # root devDeps (oxfmt, oxlint, types)
bun install --cwd extensions/subagents   # nested suite peerDeps (@earendil-works/*)
bun install --cwd extensions/goal        # nested suite dep (typebox)
bun run check     # oxfmt + oxlint type-check + tests (owned trio + goal + installer + subagents)
```

- Rules: `CODING_STANDARDS.md`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`. Issues: GitHub issues.
