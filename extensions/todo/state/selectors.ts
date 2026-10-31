import type { Task, TaskStatus } from "../tool/types.js";
import type { TaskState } from "./state.js";

/**
 * Snapshot of one pass over the visible tasks. The overlay and the /todos
 * command build this once per render with scanVisibleTasks, then read counts,
 * groups, and flags from it. Building the parts separately would rescan the
 * list once per selector.
 */
export interface VisibleScan {
  tasks: Task[];
  pending: Task[];
  inProgress: Task[];
  completed: Task[];
  total: number;
  hasActive: boolean;
  showIds: boolean;
}

/**
 * One pass over state.tasks that partitions the visible tasks by status and
 * derives the overlay flags. The returned arrays share task references with
 * the state; callers must not mutate them.
 *
 * Complexity: O(n) time, O(v) space for v visible tasks.
 */
export function scanVisibleTasks(state: TaskState): VisibleScan {
  const tasks: Task[] = [];
  const pending: Task[] = [];
  const inProgress: Task[] = [];
  const completed: Task[] = [];
  let hasActive = false;
  let showIds = false;
  for (const t of state.tasks) {
    if (t.status === "deleted") continue;
    tasks.push(t);
    if (t.status === "pending") {
      pending.push(t);
      hasActive = true;
    } else if (t.status === "in_progress") {
      inProgress.push(t);
      hasActive = true;
    } else {
      completed.push(t);
    }
    if (t.blockedBy?.length) showIds = true;
  }
  return { tasks, pending, inProgress, completed, total: tasks.length, hasActive, showIds };
}

/**
 * Tasks excluding deleted tombstones. This is the canonical "what is
 * visible". Prefer scanVisibleTasks when the caller also needs counts,
 * groups, or flags from the same render.
 *
 * Complexity: O(n) time, O(v) space for v visible tasks.
 */
export function selectVisibleTasks(state: TaskState): Task[] {
  return scanVisibleTasks(state).tasks;
}

/**
 * Group visible tasks by status. Call sites iterate the groups as
 * (completed, inProgress, pending) to match the /todos header part order.
 *
 * Complexity: O(n) time, O(v) space. Prefer scanVisibleTasks when the caller
 * also needs counts or flags from the same render.
 */
export interface TasksByStatus {
  pending: readonly Task[];
  inProgress: readonly Task[];
  completed: readonly Task[];
}
export function selectTasksByStatus(state: TaskState): TasksByStatus {
  const scan = scanVisibleTasks(state);
  return { pending: scan.pending, inProgress: scan.inProgress, completed: scan.completed };
}

/** Total counts for the overlay heading (Todos n/m) and the /todos header. */
export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

/**
 * Complexity: O(n) time, O(v) space. Prefer scanVisibleTasks when the caller
 * also needs groups or flags from the same render.
 */
export function selectTodoCounts(state: TaskState): TodoCounts {
  const scan = scanVisibleTasks(state);
  return {
    total: scan.total,
    pending: scan.pending.length,
    inProgress: scan.inProgress.length,
    completed: scan.completed.length,
  };
}

/**
 * True when any visible task carries a blockedBy reference. The overlay uses
 * this to gate the #id prefix on per-task rows: without at least one
 * chain suffix, the per-row id has no anchor.
 *
 * Complexity: O(n) worst case, O(1) space. Prefer scanVisibleTasks when the
 * caller also needs groups or counts from the same render.
 */
export function selectShowTaskIds(state: TaskState): boolean {
  return scanVisibleTasks(state).showIds;
}

/**
 * Resolve a task's subject by id from the live state for the renderCall
 * accent label. Returns undefined when the id is unknown; the caller falls
 * back to plain #id rendering.
 *
 * Complexity: O(n) time, O(1) space. This stays a scan: renderCall runs once
 * per tool call label, so an index build would cost as much as the scan.
 */
export function selectTaskSubjectById(state: TaskState, id: number): string | undefined {
  return state.tasks.find((t) => t.id === id)?.subject;
}

/**
 * Overlay layout decision. Encapsulates the "drop completed first, then
 * truncate non-completed tail" rule. budget is the body-slot count (the
 * caller passes getMaxWidgetLines() - 1 to reserve the heading row); on
 * overflow the selector reserves one more slot internally for the summary
 * row. Returns the visible task slice plus the overflow summary parts.
 *
 * Complexity: O(n) time, O(n) space. Accepts a VisibleScan so the overlay
 * render pays for one scan total instead of one per selector.
 */
export interface OverlayLayout {
  visible: readonly Task[];
  hiddenCompleted: number;
  truncatedTail: number;
  truncatedInProgress: number;
}
export function selectOverlayLayout(state: TaskState, budget: number): OverlayLayout {
  return layoutFromScan(scanVisibleTasks(state), budget);
}

/** Layout over a precomputed scan. Complexity: O(n) time, O(n) space. */
export function layoutFromScan(scan: VisibleScan, budget: number): OverlayLayout {
  const all = scan.tasks;
  if (all.length <= budget) {
    return { visible: all, hiddenCompleted: 0, truncatedTail: 0, truncatedInProgress: 0 };
  }
  const innerBudget = budget - 1;
  const nonCompleted = [...scan.pending, ...scan.inProgress];
  const totalCompleted = scan.completed.length;
  if (nonCompleted.length <= innerBudget) {
    const kept = new Set<Task>(nonCompleted);
    for (const t of all) {
      if (kept.size >= innerBudget) break;
      if (t.status === "completed") kept.add(t);
    }
    const visible = all.filter((t) => kept.has(t));
    const shownCompleted = scan.completed.filter((t) => kept.has(t)).length;
    return {
      visible,
      hiddenCompleted: totalCompleted - shownCompleted,
      truncatedTail: 0,
      truncatedInProgress: 0,
    };
  }
  const visible = nonCompleted.slice(0, innerBudget);
  const truncated = nonCompleted.slice(innerBudget);
  return {
    visible,
    hiddenCompleted: totalCompleted,
    truncatedTail: truncated.length,
    truncatedInProgress: truncated.filter((t) => t.status === "in_progress").length,
  };
}

/**
 * True when any visible task is pending or in_progress. The overlay uses
 * this to pick the heading icon (accent dot vs dim circle).
 *
 * Complexity: O(n) worst case, O(1) space. Prefer scanVisibleTasks when the
 * caller also needs groups or counts from the same render.
 */
export function selectHasActive(state: TaskState): boolean {
  return scanVisibleTasks(state).hasActive;
}

export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(["pending", "in_progress"]);
