import { describe, expect, test } from "bun:test";
import {
  normalizeReplayedState,
  replayFromBranch,
  sanitizeReplayedTasks,
} from "../../state/replay.js";
import type { Task } from "../../tool/types.js";

function branchWith(details: unknown): { sessionManager: { getBranch(): Iterable<unknown> } } {
  return {
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "toolResult", toolName: "todo", details } },
      ],
    },
  };
}

describe("todo replay hardening", () => {
  test("drops tasks with corrupt shapes", () => {
    const tasks = sanitizeReplayedTasks([
      { id: 1, subject: "ok", status: "pending" },
      { id: "2", subject: "bad id", status: "pending" },
      { id: 3, subject: 42, status: "pending" },
      { id: 4, subject: "bad status", status: "archived" },
      { id: 5, subject: "bad deps", status: "pending", blockedBy: [1, "x"] },
      null,
    ]);
    expect(tasks.map((t) => t.id)).toEqual([1]);
  });

  test("drops dangling and self edges, clamps nextId past the max id", () => {
    const state = normalizeReplayedState(
      [
        { id: 1, subject: "a", status: "pending", blockedBy: [2, 99, 1] } as Task,
        { id: 2, subject: "b", status: "pending" },
      ],
      2,
    );
    expect(state.tasks.find((t) => t.id === 1)?.blockedBy).toEqual([2]);
    expect(state.nextId).toBe(3);
  });

  test("removes the blockedBy field when no edge survives", () => {
    const state = normalizeReplayedState(
      [{ id: 1, subject: "a", status: "pending", blockedBy: [99] }],
      5,
    );
    expect(state.tasks[0]).not.toHaveProperty("blockedBy");
    expect(state.nextId).toBe(5);
  });

  test("replay keeps the last snapshot and sanitizes it once", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "todo",
              details: {
                action: "create",
                params: {},
                tasks: [{ id: 9, subject: "stale", status: "pending" }],
                nextId: 10,
              },
            },
          },
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "todo",
              details: {
                action: "create",
                params: {},
                tasks: [
                  { id: 1, subject: "fresh", status: "pending", blockedBy: [77] },
                  { id: "bad", subject: "corrupt", status: "pending" },
                ],
                nextId: 2,
              },
            },
          },
        ],
      },
    };
    const state = replayFromBranch(ctx);
    expect(state.tasks.map((t) => t.id)).toEqual([1]);
    expect(state.tasks[0]).not.toHaveProperty("blockedBy");
    expect(state.nextId).toBe(2);
  });

  test("replay ignores non-matching entries and returns empty state", () => {
    const empty = replayFromBranch({ sessionManager: { getBranch: () => [] } });
    expect(empty).toEqual({ tasks: [], nextId: 1 });
    const skipped = replayFromBranch(branchWith({ action: "create" }));
    expect(skipped).toEqual({ tasks: [], nextId: 1 });
  });
});
