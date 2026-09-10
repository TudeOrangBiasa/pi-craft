# ADR-0004: Tool Guidance Lives on Tools, APPEND Holds Only Non-Tool Rules

Status: accepted

## Context

`APPEND_SYSTEM.md` duplicated the tool roster in prose. Prose rosters rot (e.g. it claimed a core-`find` fallback after ADR-0003 stripped it). Upstream builds "Available tools" and adaptive guidelines from per-tool `promptSnippet`/`promptGuidelines`, which appear only while the tool is active.

## Decision

- Tool discipline lives as `promptGuidelines` on each tool definition, naming the tool explicitly (upstream requires it: flat bullets carry no tool prefix). Counter-mappings (`ffgrep` over grep/rg, `fffind` over find, `read` over ls/cat, `replace`/`insert` over sed) sit next to the tools they govern.
- `APPEND_SYSTEM.md` holds only what no tool definition can carry: harness identity, tone, `-p` read-only rule, artifact restraint, bash scope (core-owned), the `write` exception (core-owned), judgment routing, and lazy doc pointers.

## Consequences

- Guideline and tool stay in sync by construction; disabling a tool removes its guidance automatically.
- APPEND stays short — token debt is paid once per session, not per turn.
