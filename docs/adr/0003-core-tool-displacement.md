# ADR-0003: Displace Redundant Core Tools at Startup

Status: accepted

## Context

Our forks supersede core tools (`ffgrep`→grep, `fffind`→find, `read`→ls, `replace`/`insert`→edit), but Pi kept the core versions active alongside — duplicate roster entries that confuse cheap models and trigger upstream's "use bash for ls/rg/find" fallback guideline.

## Decision

`hashline` strips `edit`, `grep`, `find`, `ls` from the active set at `session_start` (single owner for core displacement). Core `read` is SPARED: it shares the name with our `read` and Pi tolerates exactly one winner — name-filtering could remove the winner and break anchors.

## Consequences

- Roster holds one tool per job; `ffgrep`/`fffind`/`read` are the routed primaries.
- Stripping grep/find/ls fires upstream's bash-fallback guideline, which our per-tool `promptGuidelines` explicitly counter (see ADR-0004).
- `toggle-anchor-grep` only toggles `anchor_grep`; core grep is never restored.
