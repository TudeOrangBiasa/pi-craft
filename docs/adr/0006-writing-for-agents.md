# ADR-0006: Author Agent-Facing Docs with writing-for-agents

Status: accepted

## Context

Skills, agents, rules, and `AGENTS.md` pointers are all documents agents consume. Without shared levers they bloat: duplicated meanings, weak triggers, prohibitions that invoke the banned behaviour.

## Decision

All agent-facing writing (skills, `agents/*.md`, guidance, `APPEND_SYSTEM.md`) follows the `writing-for-agents` levers:

- One meaning, one source of truth (ADR-0004 is this lever applied to prompts).
- Context pointers with one trigger per branch; front-load the leading word.
- Progressive disclosure down the information hierarchy; prune no-ops and sediment.
- Prompt the positive; a prohibition earns its place only as an unpaired hard guardrail.

## Consequences

- New agent docs get reviewed against these levers, not taste.
- Existing docs (APPEND, reviewer agents, guidance) are already shaped by them; drift gets pruned on touch.
