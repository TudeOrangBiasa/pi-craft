# ADR-0008: No PLANS.md, No ARCHITECTURE.md — Docs as Docs, Source as Source

Status: accepted

## Context

The harness playbook audit flagged missing `PLANS.md` and `docs/ARCHITECTURE.md` as gaps. The playbook assumes them; this repo deliberately trims them.

## Decision

- No `PLANS.md`: multi-step work is tracked in `.scratch/` specs + issues (see `docs/agents/issue-tracker.md`). A root plan file would duplicate the tracker.
- No `docs/ARCHITECTURE.md`: architecture lives in the source tree itself plus ADRs for decisions. A prose mirror would rot on every refactor.
- Convention: `docs/` holds runbooks and records, source code is the architecture, `CONTEXT.md` is the glossary. Each meaning in exactly one place (see ADR-0006).

## Consequences

- Playbook gap #5 is declined by design, not deferred.
- New contributors read `CONTEXT.md` → `docs/agents/` → source, in that order.
