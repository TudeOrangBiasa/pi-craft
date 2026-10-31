import type { TaskState } from "../state/state.js";
import type { Op } from "../state/state-reducer.js";
import { collectBlockers } from "../state/task-graph.js";
import { sanitizeTerminalText } from "./sanitize.js";
import type { Task, TaskAction, TaskDetails, TaskMutationParams } from "./types.js";

/**
 * Format a single task as a `[status] #id subject [(activeForm)] [chain]` line.
 * Used by the `list` content branch only; the overlay and /todos formatting
 * paths use view/format.ts for richer presentations.
 *
 * Complexity: O(d) for d deps on this task.
 */
function formatListLine(t: Task): string {
  const block = t.blockedBy?.length ? ` ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  const form =
    t.status === "in_progress" && t.activeForm ? ` (${sanitizeTerminalText(t.activeForm)})` : "";
  return `[${t.status}] #${t.id} ${sanitizeTerminalText(t.subject)}${form}${block}`;
}

/**
 * Multi-line presentation for the `get` action. Row order is description,
 * activeForm, blockedBy, blocks, owner. The reverse `blocks` edge for this
 * one task is collected by scan, not by building the full inverse map.
 *
 * Complexity: O(n + E) worst case, with n tasks and E total blockedBy edges.
 */
function formatGetLines(task: Task, state: TaskState): string {
  const blocks = collectBlockers(state.tasks, task.id);
  const lines = [`#${task.id} [${task.status}] ${sanitizeTerminalText(task.subject)}`];
  if (task.description) lines.push(`  description: ${sanitizeTerminalText(task.description)}`);
  if (task.activeForm) lines.push(`  activeForm: ${sanitizeTerminalText(task.activeForm)}`);
  if (task.blockedBy?.length) {
    lines.push(`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
  }
  if (blocks.length) {
    lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
  }
  if (task.owner) lines.push(`  owner: ${sanitizeTerminalText(task.owner)}`);
  return lines.join("\n");
}

/**
 * Pure formatter: (op, state) → string. Closed switch on `op.kind`; adding a
 * new `Op` variant fails to compile here until a branch is added.
 *
 * Complexity: O(n + E) worst case on the `list` and `get` branches (one scan
 * of n tasks, plus E dep ids across the rendered rows); O(n) on `create`
 * (one lookup scan); O(1) on the rest.
 */
export function formatContent(op: Op, state: TaskState): string {
  switch (op.kind) {
    case "create": {
      const t = state.tasks.find((x) => x.id === op.taskId);
      // The reducer just appended this id, so the lookup always hits.
      if (!t) return `Created #${op.taskId}`;
      return `Created #${t.id}: ${sanitizeTerminalText(t.subject)} (pending)`;
    }
    case "update": {
      if (!op.changed) {
        return `No change: #${op.id} already matches the requested values (status: ${op.toStatus})`;
      }
      const transition =
        op.fromStatus !== op.toStatus ? ` (${op.fromStatus} → ${op.toStatus})` : "";
      return `Updated #${op.id}${transition}`;
    }
    case "delete":
      return `Deleted #${op.id}: ${sanitizeTerminalText(op.subject)}`;
    case "clear":
      return `Cleared ${op.count} tasks`;
    case "list": {
      let view = state.tasks;
      if (!op.includeDeleted) view = view.filter((t) => t.status !== "deleted");
      if (op.statusFilter) view = view.filter((t) => t.status === op.statusFilter);
      return view.length === 0 ? "No tasks" : view.map(formatListLine).join("\n");
    }
    case "get":
      return formatGetLines(op.task, state);
    case "error":
      return `Error: ${op.message}`;
  }
}

/**
 * Build the LLM-facing tool envelope after the store has committed the
 * reducer's new state. `details` is the persistence and replay snapshot;
 * state/replay.ts consumes this exact shape on session lifecycle events.
 *
 * Complexity: O(n + E) on the `list` and `get` branches (see formatContent);
 * O(1) besides that. The snapshot aliases the live task array (no copy).
 */
export function buildToolResult(
  action: TaskAction,
  params: TaskMutationParams,
  state: TaskState,
  op: Op,
): { content: Array<{ type: "text"; text: string }>; details: TaskDetails } {
  const text = formatContent(op, state);
  const details: TaskDetails = {
    action,
    params: params as Record<string, unknown>,
    tasks: state.tasks,
    nextId: state.nextId,
    ...(op.kind === "error" ? { error: op.message } : {}),
  };
  return { content: [{ type: "text", text }], details };
}
