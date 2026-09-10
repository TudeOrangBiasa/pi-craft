# ADR-0002: Subagents Fail Closed

Status: accepted

## Context

The `subagents` fork wrapped subagent dispatch with a fallback path. A fallback that silently degrades means the main agent can proceed thinking delegation happened when it did not — a correctness hole for cheap models that already struggle to track delegation state.

## Decision

Module default is `NO_FALLBACK`; `subagents.json` sets `fallbackSubagent: none`. Read-only bash is kept because Explore prompts depend on git. Failures surface loudly instead of degrading quietly.

## Consequences

- Delegation errors block instead of silently continuing; callers must handle the error.
- Explore-family prompts keep working via read-only git access.
