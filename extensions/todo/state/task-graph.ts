import type { Task } from "../tool/types.js";

/**
 * Build an id index over a task list in one pass. The reducer builds this
 * once per create/update call, so dependency validation costs O(1) per id
 * instead of one O(n) scan per id.
 *
 * Duplicate ids cannot occur through the reducer (ids come from nextId). If
 * a corrupt replayed snapshot holds any, the last task wins the slot.
 *
 * Complexity: O(n) time and space to build, where n is the task count.
 * Lookups on the returned map are O(1) amortized.
 */
export function indexTasksById(taskList: readonly Task[]): Map<number, Task> {
  const byId = new Map<number, Task>();
  for (const t of taskList) {
    byId.set(t.id, t);
  }
  return byId;
}

/**
 * Check whether replacing taskId's blockedBy with newBlockedBy would close a
 * cycle in the dependency graph. The caller passes the full replacement list
 * (kept deps plus additions), so this function reads edges straight from the
 * index without copying them.
 *
 * The check is pure: it takes the index explicitly, so the reducer can ask
 * "would this update cycle?" without mutating state first. Unknown dep ids
 * (only possible in a corrupt replayed snapshot) count as leaves.
 *
 * Complexity: O(V + E) time and O(V) space, where V is the task count and E
 * is the total blockedBy edge count.
 */
export function detectCycle(
  byId: ReadonlyMap<number, Task>,
  taskId: number,
  newBlockedBy: readonly number[],
): boolean {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const edgesOf = (node: number): readonly number[] => {
    if (node === taskId) return newBlockedBy;
    return byId.get(node)?.blockedBy ?? [];
  };
  const hasCycleFrom = (node: number): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of edgesOf(node)) {
      if (hasCycleFrom(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of byId.keys()) {
    if (hasCycleFrom(node)) return true;
  }
  return false;
}

/**
 * Build the inverse adjacency map: for each task id, the ids of tasks that
 * list it in their blockedBy. Use collectBlockers when only one entry is
 * needed.
 *
 * Complexity: O(n + E) time and space, where n is the task count and E is
 * the total blockedBy edge count.
 */
export function deriveBlocks(taskList: readonly Task[]): Map<number, number[]> {
  const blocks = new Map<number, number[]>();
  for (const t of taskList) {
    for (const dep of t.blockedBy ?? []) {
      const arr = blocks.get(dep) ?? [];
      arr.push(t.id);
      blocks.set(dep, arr);
    }
  }
  return blocks;
}

/**
 * Collect the reverse edges for one task: the ids of tasks whose blockedBy
 * includes id, in task order. Same result as deriveBlocks(taskList).get(id)
 * without building the full map. The get action uses this for its
 * "blocks: #x, #y" line.
 *
 * Complexity: O(n + E) worst case, O(k) extra space for k blockers.
 */
export function collectBlockers(taskList: readonly Task[], id: number): number[] {
  const blockers: number[] = [];
  for (const t of taskList) {
    if (t.blockedBy?.includes(id)) blockers.push(t.id);
  }
  return blockers;
}
