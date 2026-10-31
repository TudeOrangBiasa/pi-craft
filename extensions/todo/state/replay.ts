import type { Task, TaskDetails } from "../tool/types.js";
import { EMPTY_STATE, type TaskState } from "./state.js";

/**
 * Discriminator for `details` envelopes that match the persisted `TaskDetails`
 * shape. Branch entries from older or corrupt sessions fail this check and
 * the walker skips them.
 *
 * Complexity: O(1). Only the envelope shape is checked here; each task is
 * checked in sanitizeReplayedTasks when its snapshot wins.
 */
export function isTaskDetails(value: unknown): value is TaskDetails {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

function isReplayableTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "number" || !Number.isInteger(v.id)) return false;
  if (typeof v.subject !== "string") return false;
  if (
    v.status !== "pending" &&
    v.status !== "in_progress" &&
    v.status !== "completed" &&
    v.status !== "deleted"
  ) {
    return false;
  }
  if (v.blockedBy !== undefined) {
    if (!Array.isArray(v.blockedBy)) return false;
    if (!v.blockedBy.every((dep) => typeof dep === "number" && Number.isInteger(dep))) return false;
  }
  return true;
}

/**
 * Keep only tasks that match the Task shape: integer id, string subject, a
 * known status, and (when present) an integer blockedBy list. Corrupt branch
 * entries cannot poison the store through replay.
 *
 * Complexity: O(n + E), with n tasks and E total blockedBy edges.
 */
export function sanitizeReplayedTasks(tasks: readonly unknown[]): Task[] {
  const clean: Task[] = [];
  for (const t of tasks) {
    if (!isReplayableTask(t)) continue;
    const copy: Task = { id: t.id, subject: t.subject, status: t.status };
    if (typeof t.description === "string") copy.description = t.description;
    if (typeof t.activeForm === "string") copy.activeForm = t.activeForm;
    if (t.blockedBy) copy.blockedBy = [...t.blockedBy];
    if (typeof t.owner === "string") copy.owner = t.owner;
    if (t.metadata && typeof t.metadata === "object")
      copy.metadata = { ...(t.metadata as Record<string, unknown>) };
    clean.push(copy);
  }
  return clean;
}

/**
 * Ensure every blockedBy id resolves to a real task and back nextId past the
 * highest id. Dropped edges and a clamped counter cannot happen through the
 * reducer (validation rejects them); this only repairs corrupt snapshots.
 *
 * Complexity: O(n + E).
 */
export function normalizeReplayedState(tasks: Task[], nextId: number): TaskState {
  const ids = new Set<number>();
  let maxId = 0;
  for (const t of tasks) {
    ids.add(t.id);
    if (t.id > maxId) maxId = t.id;
  }
  for (const t of tasks) {
    if (t.blockedBy?.length) {
      const kept = t.blockedBy.filter((dep) => dep !== t.id && ids.has(dep));
      if (kept.length) t.blockedBy = kept;
      else delete t.blockedBy;
    }
  }
  const safeNextId = Number.isInteger(nextId) && nextId > maxId ? nextId : maxId + 1;
  return { tasks, nextId: safeNextId };
}

/**
 * Walk the current branch in chronological order; the LAST `toolResult` whose
 * `toolName` is "todo" and whose `details` matches TaskDetails wins
 * (last write wins). When no matching entry exists, returns EMPTY_STATE.
 *
 * Pure over module state: index.ts writes the returned snapshot into the
 * store after this returns. This function never touches the store cell.
 *
 * Complexity: O(b + n + E), with b branch entries, n tasks in the winning
 * snapshot, and E blockedBy edges. Only the winning snapshot is copied and
 * checked; earlier snapshots cost one O(1) shape test each.
 */
export function replayFromBranch(ctx: {
  sessionManager: { getBranch(): Iterable<unknown> };
}): TaskState {
  let winner: TaskDetails | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    const e = entry as {
      type?: string;
      message?: { role?: string; toolName?: string; details?: unknown };
    };
    if (e.type !== "message") continue;
    const msg = e.message;
    if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
    if (!isTaskDetails(msg.details)) continue;
    winner = msg.details;
  }
  if (!winner) {
    return { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
  }
  return normalizeReplayedState(sanitizeReplayedTasks(winner.tasks), winner.nextId);
}
