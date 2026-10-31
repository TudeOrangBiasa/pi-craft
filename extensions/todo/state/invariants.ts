import type { TaskStatus } from "../tool/types.js";

/**
 * Allowed forward transitions per source status. `completed` moves one way to
 * `deleted` (never back to `in_progress`); `deleted` is terminal.
 *
 * Idempotent same-to-same is checked separately in `isTransitionValid`, so
 * this table only lists real transitions.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  pending: new Set(["in_progress", "completed", "deleted"]),
  in_progress: new Set(["pending", "completed", "deleted"]),
  completed: new Set(["deleted"]),
  deleted: new Set(),
};

/**
 * True when a task may move from one status to another. Same-to-same always
 * passes and the envelope reports it as a no-op.
 *
 * Complexity: O(1).
 */
export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].has(to);
}
