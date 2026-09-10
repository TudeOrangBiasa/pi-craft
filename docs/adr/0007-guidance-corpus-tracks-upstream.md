# ADR-0007: Guidance Corpus Tracks Upstream Builtin-Rules

Status: accepted

## Context

Our `guidance/` held 13 TS rules but upstream `oh-my-pi` ships 27 (8 go, 6 rs, 13 ts). Our TS copies had drifted-stale scopes and the loader silently dropped rules.

## Decision

- Vendor all 27 upstream rules into `guidance/` (faithful bodies; `astCondition` files kept for parity though the v1 regex-only loader skips them).
- Adapt every scope with `tool:replace`/`tool:insert` (core `edit` is stripped per ADR-0003).
- Fix two upstream conditions that can never match from the loader's side: nested single-quotes in `go-ioutil` and `go-exp-promoted` (`'"io/ioutil"'` matches no real Go import) → bare paths. Documented here as intentional deviation.
- Fix loader bugs instead of working around them: brace-aware scope split, YAML double-quote unescaping (see session verification: 22 rules load, all fire, clean code silent).

## Consequences

- Go/Rust rules are dead load until those stacks appear — accepted per explicit user call for upstream parity.
- Future upstream sync: re-fetch bodies, re-apply the two adaptations (scope extension + quote fix).
