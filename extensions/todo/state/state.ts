import type { Task } from "../tool/types.js";

/**
 * Canonical state for the todo tool. Single source of truth: both the reducer
 * (state/state-reducer.ts) and the live store cell (state/store.ts) read
 * this shape. Replay (state/replay.ts) returns a fresh TaskState; the
 * lifecycle handlers in index.ts write it via replaceState.
 *
 * The shape stays minimal: no derived caches or runtime cells. Selectors in
 * state/selectors.ts are pure over TaskState and own all derivations
 * (visible, grouped, counted, and so on). Each public function in state/
 * documents its time complexity in its comment; n is the task count and E is
 * the total blockedBy edge count.
 */
export interface TaskState {
  tasks: Task[];
  nextId: number;
}

export const EMPTY_STATE: TaskState = { tasks: [], nextId: 1 };
