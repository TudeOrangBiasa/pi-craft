# Extension registry

Every extension in `extensions/` with owner, role, and status. Core = default roster (7 packages + 2 single-file). All core, no opt-ins.

## Owned (source of truth here, tested)

| Name | Role | Status |
| ---- | ---- | ------ |
| `bash-interceptor` | Bash→tool steering | core |
| `governor` | Central output bound | core |

## Vendored (derived from public sources; LICENSE files retain original copyright)

| Name | Role | Status |
| ---- | ---- | ------ |
| `tool-repair` | Malformed call repair | core |
| `hashline` | read/replace/insert/anchor_grep | core |
| `subagents` | Parallel sub-agents | core |
| `fff` | ffgrep/fffind | core |
| `safety-net` | Destructive-command guard | core |
| `ask` | Structured questions | core |
| `todo` | Todo overlay + reminder | core |
> `safety-net` ships only a prebuilt `dist/` bundle (no source vendored) — its
> entry point is `./dist/pi/index.js`. Do not prune it; re-vendor or drop the
> package deliberately if it ever goes stale.

