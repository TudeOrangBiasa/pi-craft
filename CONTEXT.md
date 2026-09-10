# CONTEXT.md

Seed glossary for this repo. Terms and decisions resolve lazily via `/domain-modeling` — this file grows when language is actually settled, not upfront.

## Purpose

Pi extension harness work: extensions and supporting code that run inside Pi (`pi-coding-agent`), following the extension-design rules in `CODING_STANDARDS.md`. Consumers are Pi agents (tools) and Pi users (commands/UI) — never mirrored by default.

## Layout

Extension code lives under `extensions/<name>/`. No scaffolding ahead of real code.

## Stack (settled)

TypeScript + Bun. Lint `oxlint`, format `oxfmt`. Monadic code style. See `CODING_STANDARDS.md` for the full rules.

| Term | Meaning | Avoid |
| ---- | ------- | ----- |
| owned extension | `omfg`, `bash-interceptor`, `governor` — source of truth here, tested | — |
| vendored package | Third-party extension code under `extensions/<name>/`, adapted to our roster; LICENSE retains original copyright | fork (implies upstream tracking) |
| guidance rule | `guidance/<name>.md` with frontmatter (condition + scope); auto-injected by omfg on tool_call match, never read on demand | skill, prompt |
| TTSR | Time Travelling Stream Rules — omfg's named stream-rule engine (gate/replace/inject over the token/tool stream) | filter |
| anchor | `aB3`-style row handle from `read`; the only valid edit address for `replace`/`insert` | line number |
| displacement | Removing a core tool from the active set at `session_start` because ours supersedes it | disable, hide |
| core / opt-in | Core = default roster; opt-in = parked until enabled in settings | — |

## Decisions

`docs/adr/` holds architecture decision records (`NNNN-slug.md`):
- 0001 repo-source-forks-deploy — repo is source of truth, forks are deploy targets
- 0002 subagents-fail-closed — NO_FALLBACK default, read-only bash kept
- 0003 core-tool-displacement — strip edit/grep/find/ls at startup, spare core read
- 0004 prompt-architecture — tool guidance on tools, APPEND holds non-tool rules only
- 0005 event-based-restraint — no timers/throttles/sample-key caches
- 0006 writing-for-agents — levers for all agent-facing docs
- 0007 guidance-corpus-tracks-upstream — 27 rules, scope-adapted, loader fixed
- 0008 no-plans-no-architecture-doc — docs as docs, source as source, context as glossary
