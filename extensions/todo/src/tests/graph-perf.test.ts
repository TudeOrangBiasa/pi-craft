import { describe, expect, test } from "bun:test";
import { layoutFromScan, scanVisibleTasks, selectOverlayLayout } from "../../state/selectors.js";
import type { TaskState } from "../../state/state.js";
import { applyTaskMutation } from "../../state/state-reducer.js";
import {
  collectBlockers,
  deriveBlocks,
  detectCycle,
  indexTasksById,
} from "../../state/task-graph.js";
import { formatContent } from "../../tool/response-envelope.js";
import { EMPTY_STATE } from "../../state/state.js";
import type { Task } from "../../tool/types.js";

function chainState(n: number): TaskState {
  const tasks: Task[] = [];
  for (let id = 1; id <= n; id++) {
    tasks.push(
      id === 1
        ? { id, subject: `task ${id}`, status: "pending" }
        : { id, subject: `task ${id}`, status: "pending", blockedBy: [id - 1] },
    );
  }
  return { tasks, nextId: n + 1 };
}

describe("todo graph and selectors", () => {
  test("index resolves every task in one build", () => {
    const state = chainState(50);
    const byId = indexTasksById(state.tasks);
    expect(byId.size).toBe(50);
    expect(byId.get(25)?.subject).toBe("task 25");
  });

  test("cycle check flags a back edge on the index", () => {
    const state = chainState(4);
    const byId = indexTasksById(state.tasks);
    expect(detectCycle(byId, 1, [4])).toBe(true);
    expect(detectCycle(byId, 1, [])).toBe(false);
  });

  test("collectBlockers matches the full inverse map entry", () => {
    const state = chainState(10);
    const full = deriveBlocks(state.tasks);
    for (let id = 1; id <= 10; id++) {
      expect(collectBlockers(state.tasks, id)).toEqual(full.get(id) ?? []);
    }
  });

  test("get content reports the reverse blocks edge", () => {
    const state = chainState(3);
    const text = formatContent({ kind: "get", task: state.tasks[0] }, state);
    expect(text).toContain("blocks: #2");
  });

  test("scan partitions groups, counts, and flags in one pass", () => {
    const state: TaskState = {
      tasks: [
        { id: 1, subject: "a", status: "pending" },
        { id: 2, subject: "b", status: "in_progress", blockedBy: [1] },
        { id: 3, subject: "c", status: "completed" },
        { id: 4, subject: "gone", status: "deleted" },
      ],
      nextId: 5,
    };
    const scan = scanVisibleTasks(state);
    expect(scan.total).toBe(3);
    expect(scan.pending.map((t) => t.id)).toEqual([1]);
    expect(scan.inProgress.map((t) => t.id)).toEqual([2]);
    expect(scan.completed.map((t) => t.id)).toEqual([3]);
    expect(scan.hasActive).toBe(true);
    expect(scan.showIds).toBe(true);
  });

  test("layout from scan drops completed first, then truncates the tail", () => {
    const state: TaskState = {
      tasks: [
        { id: 1, subject: "a", status: "completed" },
        { id: 2, subject: "b", status: "pending" },
        { id: 3, subject: "c", status: "in_progress" },
        { id: 4, subject: "d", status: "pending" },
      ],
      nextId: 5,
    };
    const scan = scanVisibleTasks(state);
    const fit = layoutFromScan(scan, 10);
    expect(fit.visible.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    const tight = layoutFromScan(scan, 3);
    expect(tight.visible.map((t) => t.id)).toEqual([2, 4]);
    expect(tight.hiddenCompleted).toBe(1);
    expect(tight.truncatedTail).toBe(1);
    expect(tight.truncatedInProgress).toBe(1);
    expect(layoutFromScan(scan, 3)).toEqual(selectOverlayLayout(state, 3));
  });
});

describe("todo performance smoke", () => {
  test("1000-task chain: create, update, list, get stay in operation budget", () => {
    let state = chainState(1000);
    let ops = 0;
    const countRun = (fn: () => void) => {
      const before = ops;
      fn();
      ops = before + 1;
    };
    countRun(() => {
      const created = applyTaskMutation(state, "create", {
        subject: "task 1001",
        blockedBy: [1000],
      });
      expect(created.op).toEqual({ kind: "create", taskId: 1001 });
      state = created.state;
    });
    countRun(() => {
      const updated = applyTaskMutation(state, "update", { id: 1001, status: "in_progress" });
      expect(updated.op.kind).toBe("update");
      state = updated.state;
    });
    countRun(() => {
      const listed = applyTaskMutation(state, "list", {});
      expect(listed.op.kind).toBe("list");
      const text = formatContent(listed.op, state);
      expect(text).toContain("#1001");
    });
    countRun(() => {
      const got = applyTaskMutation(state, "get", { id: 500 });
      expect(got.op.kind).toBe("get");
      if (got.op.kind === "get") {
        expect(formatContent(got.op, state)).toContain("blocks: #501");
      }
    });
    countRun(() => {
      const scan = scanVisibleTasks(state);
      expect(scan.total).toBe(1001);
      expect(layoutFromScan(scan, 12).visible.length).toBeLessThanOrEqual(12);
    });
    expect(ops).toBe(5);
  });

  test("deep chain cycle check resolves without stack growth per edge", () => {
    const state = chainState(1000);
    const byId = indexTasksById(state.tasks);
    expect(detectCycle(byId, 1000, [999])).toBe(false);
    expect(detectCycle(byId, 1, [1000])).toBe(true);
  });

  test("empty state renders empty groups", () => {
    const scan = scanVisibleTasks({ tasks: [...EMPTY_STATE.tasks], nextId: 1 });
    expect(scan.total).toBe(0);
    expect(scan.hasActive).toBe(false);
    expect(scan.showIds).toBe(false);
  });
});
