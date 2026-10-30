# ADR-0011: Goal Completion Gated on an Independent Read-Only Verifier

Status: accepted

## Context

After ADR-0010, the working agent's `goal_complete` call ends the goal on its
own claim. The project's risk rule is "never the worker's own claim": only an
independent check against the repo itself may complete a goal. No verifier
agent type and no cross-extension spawn bridge exist in the tree, and the
subagents extension exposes no programmatic spawn surface to other extensions
— its `AgentManager` is module-private and no `goal:*` bus channel is served.
The only spawn surface an outside extension can reach is the `Agent` tool,
and the only verdict channel the worker cannot forge is that tool's
`tool_result`, which Pi delivers with the spawn input attached.

## Decision

- `goal_complete` no longer ends the goal when verification is on (the
  default). The claim parks (`pendingVerdict`) and the tool result instructs
  the worker to spawn the verifier through the subagents `Agent` tool:
  `subagent_type: "Explore"` (read-only built-ins: read, bash, grep, find —
  no write/replace/insert), `run_in_background: false`, description
  `verify goal <id>`.
- The goal extension reads the verdict from the `Agent` `tool_result` only,
  and only when the echoed input matches the instructed type, description,
  and blocking mode. The verdict is one line starting with `GOAL_VERDICT:`
  followed by `PASS`, `FAIL(<what is missing>)`, or `IMPOSSIBLE(<why>)`.
- `PASS` completes the goal; `FAIL` feeds the missing items back as the next
  continuation turn; `IMPOSSIBLE` blocks it. A second consecutive `FAIL`
  with no new evidence blocks instead of looping.
- Goal state gains `lastVerdict { verdict, reason, at }`, shown by `/goal`
  status; `pendingVerdict`, `lastEvidence`, and `failStreak` persist as
  session entries so the gate survives `/reload` and `/resume`.
- Config is env-based, read per call: `PI_GOAL_VERIFY=0` disables the gate
  (the #8 fallback: the claim completes), `PI_GOAL_VERIFY_MODEL` sets the
  verifier model (default: the session model), `PI_GOAL_VERIFY_TIMEOUT_MS`
  sets the verifier's wall-clock ceiling.
- Out of scope: multi-model voting, verifier write access or auto-fixes,
  completion notifications.

## Consequences

- A goal can no longer reach `complete` on the worker's word while
  verification is on; the negative test locks this in.
- The worker performs the spawn the instructions describe, so a worker that
  ignores the `goal_complete` result stalls the goal pending — visible in
  `/goal` status as `verdict: pending`.
- No timers and no background sampling: verdict capture is event-based
  (`tool_result`), per ADR-0005. The timeout is the subagents run's own
  deadline, not goal-side machinery.
- Goal tests run offline with a fake `pi` and a stubbed verifier (fired
  `tool_result` events): no model calls, no timers.
