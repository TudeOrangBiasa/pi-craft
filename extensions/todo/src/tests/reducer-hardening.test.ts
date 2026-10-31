import { describe, expect, test } from "bun:test";
import { applyTaskMutation } from "../../state/state-reducer.js";
import type { TaskState } from "../../state/state.js";
import type { Task } from "../../tool/types.js";

function stateWith(tasks: Task[], nextId: number): TaskState {
  return {
    tasks: tasks.map((t) => ({ ...t, blockedBy: t.blockedBy ? [...t.blockedBy] : undefined })),
    nextId,
  };
}

function tasks(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    subject: `task ${i + 1}`,
    status: "pending" as const,
  }));
}

describe("todo reducer hardening", () => {
  test("create rejects a dangling blockedBy id", () => {
    const state = stateWith(tasks(2), 3);
    const result = applyTaskMutation(state, "create", { subject: "needs ghost", blockedBy: [99] });
    expect(result.op).toEqual({ kind: "error", message: "blockedBy: #99 not found" });
    expect(result.state).toBe(state);
  });

  test("create rejects a tombstoned blockedBy id", () => {
    const state = stateWith(
      [
        { id: 1, subject: "gone", status: "deleted" },
        { id: 2, subject: "alive", status: "pending" },
      ],
      3,
    );
    const result = applyTaskMutation(state, "create", { subject: "needs ghost", blockedBy: [1] });
    expect(result.op).toEqual({ kind: "error", message: "blockedBy: #1 is deleted" });
    expect(result.state).toBe(state);
  });

  test("create rejects a duplicate blockedBy id", () => {
    const state = stateWith(tasks(2), 3);
    const result = applyTaskMutation(state, "create", { subject: "dup deps", blockedBy: [1, 1] });
    expect(result.op).toEqual({ kind: "error", message: "blockedBy: duplicate #1" });
    expect(result.state).toBe(state);
  });

  test("create rejects a self-block on its own next id", () => {
    const state = stateWith(tasks(2), 3);
    const result = applyTaskMutation(state, "create", { subject: "self", blockedBy: [3] });
    expect(result.op).toEqual({ kind: "error", message: "cannot block #3 on itself" });
    expect(result.state).toBe(state);
  });

  test("create rejects a blank subject and keeps state", () => {
    const state = stateWith(tasks(1), 2);
    const result = applyTaskMutation(state, "create", { subject: "   " });
    expect(result.op).toEqual({ kind: "error", message: "subject required for create" });
    expect(result.state).toBe(state);
  });

  test("update rejects a dangling addBlockedBy id", () => {
    const state = stateWith(tasks(2), 3);
    const result = applyTaskMutation(state, "update", { id: 2, addBlockedBy: [99] });
    expect(result.op).toEqual({ kind: "error", message: "addBlockedBy: #99 not found" });
    expect(result.state).toBe(state);
  });

  test("update rejects a tombstoned addBlockedBy id", () => {
    const state = stateWith(
      [
        { id: 1, subject: "gone", status: "deleted" },
        { id: 2, subject: "alive", status: "pending" },
      ],
      3,
    );
    const result = applyTaskMutation(state, "update", { id: 2, addBlockedBy: [1] });
    expect(result.op).toEqual({ kind: "error", message: "addBlockedBy: #1 is deleted" });
    expect(result.state).toBe(state);
  });

  test("update rejects a duplicate addBlockedBy id", () => {
    const state = stateWith(tasks(3), 4);
    const result = applyTaskMutation(state, "update", { id: 3, addBlockedBy: [1, 1] });
    expect(result.op).toEqual({ kind: "error", message: "addBlockedBy: duplicate #1" });
    expect(result.state).toBe(state);
  });

  test("update rejects a self-block", () => {
    const state = stateWith(tasks(2), 3);
    const result = applyTaskMutation(state, "update", { id: 2, addBlockedBy: [2] });
    expect(result.op).toEqual({ kind: "error", message: "cannot block #2 on itself" });
    expect(result.state).toBe(state);
  });

  test("update rejects a blank subject", () => {
    const state = stateWith(tasks(1), 2);
    const result = applyTaskMutation(state, "update", { id: 1, subject: "  " });
    expect(result.op).toEqual({ kind: "error", message: "subject cannot be blank" });
    expect(result.state).toBe(state);
  });

  test("update rejects an illegal completed to in_progress transition", () => {
    const state = stateWith([{ id: 1, subject: "done", status: "completed" }], 2);
    const result = applyTaskMutation(state, "update", { id: 1, status: "in_progress" });
    expect(result.op).toEqual({
      kind: "error",
      message: "illegal transition completed → in_progress",
    });
    expect(result.state).toBe(state);
  });

  test("update rejects a move out of the deleted tombstone", () => {
    const state = stateWith([{ id: 1, subject: "gone", status: "deleted" }], 2);
    const result = applyTaskMutation(state, "update", { id: 1, status: "pending" });
    expect(result.op).toEqual({ kind: "error", message: "illegal transition deleted → pending" });
    expect(result.state).toBe(state);
  });

  test("update rejects a non-integer id", () => {
    const state = stateWith(tasks(1), 2);
    const result = applyTaskMutation(state, "update", { id: 1.5, subject: "x" });
    expect(result.op).toEqual({ kind: "error", message: "id must be an integer for update" });
    expect(result.state).toBe(state);
  });

  test("get rejects a non-integer id", () => {
    const state = stateWith(tasks(1), 2);
    const result = applyTaskMutation(state, "get", { id: Number.NaN });
    expect(result.op).toEqual({ kind: "error", message: "id must be an integer for get" });
    expect(result.state).toBe(state);
  });

  test("delete rejects a non-integer id", () => {
    const state = stateWith(tasks(1), 2);
    const result = applyTaskMutation(state, "delete", { id: 2.5 });
    expect(result.op).toEqual({ kind: "error", message: "id must be an integer for delete" });
    expect(result.state).toBe(state);
  });

  test("update rejects an edge that would close a cycle", () => {
    const state = stateWith(
      [
        { id: 1, subject: "a", status: "pending", blockedBy: [2] },
        { id: 2, subject: "b", status: "pending" },
      ],
      3,
    );
    const result = applyTaskMutation(state, "update", { id: 2, addBlockedBy: [1] });
    expect(result.op).toEqual({
      kind: "error",
      message: "addBlockedBy would create a cycle in the blockedBy graph",
    });
    expect(result.state).toBe(state);
  });

  test("failed validation never allocates ids or mutates the list", () => {
    const state = stateWith(tasks(2), 3);
    const before = JSON.stringify(state);
    for (const params of [
      { subject: "x", blockedBy: [99] },
      { subject: "x", blockedBy: [1, 1] },
      { subject: "" },
    ]) {
      const result = applyTaskMutation(state, "create", params);
      expect(result.op.kind).toBe("error");
      expect(result.state).toBe(state);
    }
    expect(JSON.stringify(state)).toBe(before);
    expect(state.nextId).toBe(3);
  });

  test("valid blockedBy still merges additively in order", () => {
    const state = stateWith(
      [
        { id: 1, subject: "a", status: "pending" },
        { id: 2, subject: "b", status: "pending" },
        { id: 3, subject: "c", status: "pending", blockedBy: [1] },
      ],
      4,
    );
    const added = applyTaskMutation(state, "update", { id: 3, addBlockedBy: [2, 1] });
    expect(added.op.kind).toBe("update");
    expect(added.state.tasks.find((t) => t.id === 3)?.blockedBy).toEqual([1, 2]);
    const removed = applyTaskMutation(added.state, "update", { id: 3, removeBlockedBy: [1] });
    expect(removed.state.tasks.find((t) => t.id === 3)?.blockedBy).toEqual([2]);
  });
});
