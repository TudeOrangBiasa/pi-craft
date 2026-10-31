import type { Task, TaskAction, TaskMutationParams, TaskStatus } from "../tool/types.js";
import { isTransitionValid } from "./invariants.js";
import type { TaskState } from "./state.js";
import { detectCycle, indexTasksById } from "./task-graph.js";

/**
 * Reducer outcome. Closed tagged union: adding a new action requires extending
 * this union AND the response-envelope's `formatContent` switch (the compiler
 * enforces exhaustiveness).
 *
 * `error` carries the message in-band so callers can pattern-match on
 * `op.kind === "error"` without a side-channel boolean.
 */
export type Op =
  | { kind: "create"; taskId: number }
  | { kind: "update"; id: number; fromStatus: TaskStatus; toStatus: TaskStatus; changed: boolean }
  | { kind: "delete"; id: number; subject: string }
  | { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
  | { kind: "get"; task: Task }
  | { kind: "clear"; count: number }
  | { kind: "error"; message: string };

export interface ApplyResult {
  state: TaskState;
  op: Op;
}

function errorResult(state: TaskState, message: string): ApplyResult {
  return { state, op: { kind: "error", message } };
}

function sameNumberList(a: number[] | undefined, b: number[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function sameRecord(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * True when this `update` changed anything. Compares the task before and after
 * the params apply. A no-effect update (status set to its current value, or
 * any field re-sent unchanged) returns false, letting the response envelope
 * say "No change" instead of "Updated #N". Without this, a no-op update reads
 * the same as a real mutation, which can drive a model to re-issue the same
 * call in a loop.
 *
 * blockedBy is order-sensitive (the reducer preserves insertion order);
 * metadata round-trips through JSON persistence, so JSON-equality is the
 * operative notion of "changed".
 */
function taskChanged(before: Task, after: Task): boolean {
  return (
    before.subject !== after.subject ||
    before.status !== after.status ||
    before.description !== after.description ||
    before.activeForm !== after.activeForm ||
    before.owner !== after.owner ||
    !sameNumberList(before.blockedBy, after.blockedBy) ||
    !sameRecord(before.metadata, after.metadata)
  );
}

/**
 * Validate one dependency id against the index: it must exist and must not be
 * a tombstone. Returns the rejection message, or undefined when valid.
 *
 * Complexity: O(1) amortized on a prebuilt index.
 */
function depError(
  byId: ReadonlyMap<number, Task>,
  dep: number,
  prefix: string,
): string | undefined {
  const depTask = byId.get(dep);
  if (!depTask) return `${prefix}: #${dep} not found`;
  if (depTask.status === "deleted") return `${prefix}: #${dep} is deleted`;
  return undefined;
}

/** True for ids the state can address: the reducer only issues integers. */
function isValidId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id);
}

/**
 * Pure reducer: (state, action, params) → (state, op). The response envelope
 * (tool/response-envelope.ts) owns formatting and the store (state/store.ts)
 * owns commit; this function only validates and computes the next state.
 *
 * Validation runs here: structural guards (`subject required`, `id
 * required`, `at least one mutable field`) plus state-aware checks
 * (transition legality, missing or tombstoned blockedBy, self-block,
 * duplicates, cycles). Every rejection returns the input state unchanged
 * with an explicit message; nothing fails silently.
 *
 * Complexity per action, with n tasks and E total blockedBy edges:
 * create: O(n + d) for d requested deps (one index build, O(1) per dep).
 * update: O(n + E) worst case (one scan to locate the task, one index build
 * for dep validation, one cycle check).
 * list: O(1); the envelope filters in O(n) at render time.
 * get, delete: O(n) single scan. clear: O(1).
 */
export function applyTaskMutation(
  state: TaskState,
  action: TaskAction,
  params: TaskMutationParams,
): ApplyResult {
  switch (action) {
    case "create": {
      if (!params.subject?.trim()) {
        return errorResult(state, "subject required for create");
      }
      if (params.blockedBy?.length) {
        const byId = indexTasksById(state.tasks);
        const seen = new Set<number>();
        for (const dep of params.blockedBy) {
          if (seen.has(dep)) return errorResult(state, `blockedBy: duplicate #${dep}`);
          seen.add(dep);
          if (dep === state.nextId) return errorResult(state, `cannot block #${dep} on itself`);
          const invalid = depError(byId, dep, "blockedBy");
          if (invalid) return errorResult(state, invalid);
        }
      }
      const newTask: Task = {
        id: state.nextId,
        subject: params.subject,
        status: "pending",
      };
      if (params.description) newTask.description = params.description;
      if (params.activeForm) newTask.activeForm = params.activeForm;
      if (params.blockedBy?.length) newTask.blockedBy = [...params.blockedBy];
      if (params.owner) newTask.owner = params.owner;
      if (params.metadata) newTask.metadata = { ...params.metadata };

      const newTasks = [...state.tasks, newTask];
      return {
        state: { tasks: newTasks, nextId: state.nextId + 1 },
        op: { kind: "create", taskId: newTask.id },
      };
    }

    case "update": {
      if (params.id === undefined) return errorResult(state, "id required for update");
      if (!isValidId(params.id)) return errorResult(state, "id must be an integer for update");
      const idx = state.tasks.findIndex((t) => t.id === params.id);
      if (idx === -1) return errorResult(state, `#${params.id} not found`);
      const current = state.tasks[idx];
      if (params.blockedBy !== undefined)
        return errorResult(
          state,
          "blockedBy is create-only; use addBlockedBy/removeBlockedBy to change dependencies",
        );

      const hasMutation =
        params.subject !== undefined ||
        params.description !== undefined ||
        params.activeForm !== undefined ||
        params.status !== undefined ||
        params.owner !== undefined ||
        params.metadata !== undefined ||
        (params.addBlockedBy && params.addBlockedBy.length > 0) ||
        (params.removeBlockedBy && params.removeBlockedBy.length > 0);
      if (!hasMutation)
        return errorResult(
          state,
          "update requires at least one mutable field: subject, description, activeForm, status, owner, metadata, addBlockedBy, or removeBlockedBy",
        );
      if (params.subject !== undefined && !params.subject.trim()) {
        return errorResult(state, "subject cannot be blank");
      }

      let newStatus = current.status;
      if (params.status !== undefined) {
        if (!isTransitionValid(current.status, params.status)) {
          return errorResult(state, `illegal transition ${current.status} → ${params.status}`);
        }
        newStatus = params.status;
      }

      let newBlockedBy = current.blockedBy ? [...current.blockedBy] : [];
      if (params.removeBlockedBy?.length) {
        const toRemove = new Set(params.removeBlockedBy);
        newBlockedBy = newBlockedBy.filter((dep) => !toRemove.has(dep));
      }
      if (params.addBlockedBy?.length) {
        const byId = indexTasksById(state.tasks);
        const seen = new Set<number>();
        const merged = new Set(newBlockedBy);
        for (const dep of params.addBlockedBy) {
          if (seen.has(dep)) return errorResult(state, `addBlockedBy: duplicate #${dep}`);
          seen.add(dep);
          if (dep === current.id)
            return errorResult(state, `cannot block #${current.id} on itself`);
          const invalid = depError(byId, dep, "addBlockedBy");
          if (invalid) return errorResult(state, invalid);
          merged.add(dep);
        }
        newBlockedBy = [...merged];
        if (detectCycle(byId, current.id, newBlockedBy)) {
          return errorResult(state, "addBlockedBy would create a cycle in the blockedBy graph");
        }
      }

      let newMetadata = current.metadata;
      if (params.metadata !== undefined) {
        const merged: Record<string, unknown> = { ...current.metadata };
        for (const [k, v] of Object.entries(params.metadata)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        newMetadata = Object.keys(merged).length ? merged : undefined;
      }

      const updated: Task = { ...current, status: newStatus };
      if (params.subject !== undefined) updated.subject = params.subject;
      if (params.description !== undefined) updated.description = params.description;
      if (params.activeForm !== undefined) updated.activeForm = params.activeForm;
      if (params.owner !== undefined) updated.owner = params.owner;
      if (newBlockedBy.length) updated.blockedBy = newBlockedBy;
      else delete updated.blockedBy;
      if (newMetadata === undefined) delete updated.metadata;
      else updated.metadata = newMetadata;

      const newTasks = [...state.tasks];
      newTasks[idx] = updated;
      return {
        state: { tasks: newTasks, nextId: state.nextId },
        op: {
          kind: "update",
          id: updated.id,
          fromStatus: current.status,
          toStatus: newStatus,
          changed: taskChanged(current, updated),
        },
      };
    }

    case "list": {
      return {
        state,
        op: {
          kind: "list",
          includeDeleted: params.includeDeleted === true,
          ...(params.status !== undefined ? { statusFilter: params.status } : {}),
        },
      };
    }

    case "get": {
      if (params.id === undefined) return errorResult(state, "id required for get");
      if (!isValidId(params.id)) return errorResult(state, "id must be an integer for get");
      const task = state.tasks.find((t) => t.id === params.id);
      if (!task) return errorResult(state, `#${params.id} not found`);
      return { state, op: { kind: "get", task } };
    }

    case "delete": {
      if (params.id === undefined) return errorResult(state, "id required for delete");
      if (!isValidId(params.id)) return errorResult(state, "id must be an integer for delete");
      const idx = state.tasks.findIndex((t) => t.id === params.id);
      if (idx === -1) return errorResult(state, `#${params.id} not found`);
      const current = state.tasks[idx];
      if (current.status === "deleted")
        return errorResult(state, `#${current.id} is already deleted`);
      const updated: Task = { ...current, status: "deleted" };
      const newTasks = [...state.tasks];
      newTasks[idx] = updated;
      return {
        state: { tasks: newTasks, nextId: state.nextId },
        op: { kind: "delete", id: updated.id, subject: updated.subject },
      };
    }

    case "clear": {
      const count = state.tasks.length;
      return {
        state: { tasks: [], nextId: 1 },
        op: { kind: "clear", count },
      };
    }
  }
}
