# Extension registry

Every extension in `extensions/` with owner, role, and status. Core = default roster (12 packages + 3 single-file). Opt-in = parked, enable via settings.

## Owned (source of truth here, tested)

| Name | Role | Status |
| ---- | ---- | ------ |
| `omfg` | Stream rules (TTSR) + guidance injector | core |
| `bash-interceptor` | Bash→tool steering | core |
| `governor` | Central output bound | core |

## Vendored (derived from public sources; LICENSE files retain original copyright)

| Name | Role | Status |
| ---- | ---- | ------ |
| `tool-repair` | Malformed call repair | core |
| `hashline` | read/replace/insert/anchor_grep | core |
| `subagents` | Parallel sub-agents | core |
| `fff` | ffgrep/fffind | core |
| `vision` | Vision for text-only models | core |
| `safety-net` | Destructive-command guard | core |
| `rtk` | Output compaction | core |
| `ask` | Structured questions | core |
| `args` | $1/placeholders + shell substitution | core |
| `clear` | /clear + side questions | core |
| `todo` | Todo overlay + reminder | core |
| `cache-hit` | Cache predictions | core |
| `advisor` | Second-opinion model | opt-in |
| `btw` | Side questions (lighter) | opt-in |
| `preview` | Rendered preview | opt-in |
| `web` | Web search/fetch | opt-in |
`_pi-extensions/` holds live Pi-side fragments (rtk config, vision handoff json) — not packages.

> `safety-net` ships only a prebuilt `dist/` bundle (no source vendored) — its
> entry point is `./dist/pi/index.js`. Do not prune it; re-vendor or drop the
> package deliberately if it ever goes stale.
