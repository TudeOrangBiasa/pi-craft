# ADR-0009: RTK Removed — Command Rewriting Is Not Allowed

Status: accepted

## Context

The vendored `pi-rtk-optimizer` extension sat in the core roster. In `rewrite`
mode it rewrote every supported bash command through the external `rtk rewrite`
binary, posted a "RTK rewrite: old → new" notification per command, ran its own
output-compaction pipeline over bash/read/grep results, and registered the
`/rtk` TUI command. Rewriting changes the command text downstream handlers see:
`safety-net`'s destructive-command guard and the model's own permission gates
evaluate the rewritten string, not what the model actually wrote — so a rewrite
can silently alter what permission checks approve. (See the discussion on issue
#2, which cites the X note that rewrites change what permission checks see.)

## Decision

- RTK removed — command rewriting is not allowed; output bounding lives in
  governor only.
- Deleted `extensions/rtk/` (vendored package) and
  `extensions/_pi-extensions/pi-rtk-optimizer/` (live Pi-side config fragment).
  No `/rtk` command, no rewrite notifications, no RTK compaction pipeline.
- The `rtk` entry is dropped from the installer roster and `REGISTRY.md`
  (11 core packages + 3 single-file extensions). A fresh install deploys no RTK
  fork dir and no RTK settings entry (#1's stale-prune removes `forks/rtk` and
  its `settings.json` package entries; a one-time cleanup removes the live
  `extensions/pi-rtk-optimizer` config dir the old extension managed at
  runtime).
- Governor's contract is unchanged: 500 lines / 50 KB ceiling, tail mode for
  bash, `…[truncated by governor…]` notice. Bash-interceptor's block rules are
  unchanged — both now see the original model-written command.
- The external `rtk` binary is untouched: still installed if it was, now
  unused; removal is a manual user step, never an agent action.

## Consequences

- Bash runs verbatim: executed command equals model input, so permission and
  policy checks inspect exactly what runs.
- Context savings from RTK compaction are gone; long outputs are cut only by
  governor's ceiling — accepted as the price of trustworthy dispatch.
- No component may rewrite `input.command` again. Any future proposal that
  mutates command text between model and execution must re-open this ADR.
