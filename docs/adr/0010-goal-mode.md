# ADR-0010: Goal Mode Owned In-Repo, Modeled on Claude Code /goal + @piex-dev/goal

Status: superseded (goal extension removed in minimal-durable trim; record kept as history)

## Context

Pi stops after every turn; pi-craft has no autonomous completion loop. Users want
to state a checkable stop condition once and have Pi keep working until it holds,
a real blocker appears, or a budget runs out — the Claude Code `/goal` shape.
The reference designs are Claude Code `/goal` and the `@piex-dev/goal`
extension (agent_settled continuation, goal_id stale guard, appendEntry
persistence, toolVisibility after-first-goal).

## Decision

- Own a small `goal` extension in-repo (`extensions/goal/`): `/goal` command
  with start/show/pause/resume/clear, idle-gated continuation, terminal tools
  `goal_complete({goal_id, evidence})` / `goal_blocked({goal_id, reason})`,
  status machine `active | paused | blocked | budget_limited | complete`.
- Continuation fires only on Pi's `agent_settled` event — the fully-idle point
  after retries, compaction, and steering drain — and never twice per idle point.
  Budget exhaustion queues exactly one wrap-up turn, then stops. Terminal states
  never continue (no "goal anxiety").
- State persists as custom session entries (`goal-state` customType) so the goal
  survives `/reload` and `/resume`; the goal tools register with
  `defaultActive: false` and activate only after the first `/goal`, keeping
  non-goal sessions' prompt cache stable.
- Single goal per session; starting a second asks to replace. No verifier here
  (#9 owns independent verification); no cross-session goals or notifications.

## Consequences

- Autonomous loops are bounded and auditable: predicate first, budget, no
  relaxing the predicate, stop on predicate/budget/blocker.
- The installer roster and `bun run check` gain the owned package; tests run
  offline with a fake `pi` (no model calls, no timers).

## Links

- Claude Code `/goal`: https://code.claude.com/docs/en/goal
- `@piex-dev/goal` reference behaviors: agent_settled continuation, goal_id
  stale guard, appendEntry persistence, toolVisibility after-first-goal.
