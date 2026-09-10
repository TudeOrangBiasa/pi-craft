# ADR-0005: Event-Based Restraint Over Timers and Sampling

Status: accepted

## Context

Proposals for the `todo` reminder (timer-based nudges, throttles) and `vision` memoization (sample-key caching) added background machinery: timers to manage, throttle state to tune, cache keys to invalidate.

## Decision

- Todo nudge is event-based only (`before_agent_start`, display off by default).
- Vision memoizes by `WeakMap` identity — no keys, no invalidation, GC does the cleanup.
- Timer-based reminders, throttle windows, and sample-key caches are rejected.

## Consequences

- Zero per-turn cost while features are idle; no background state to debug.
- Nudges fire on session events rather than wall-clock — coarser, but free.
