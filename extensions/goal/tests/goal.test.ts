import { describe, expect, test } from "bun:test";
import activate, { GOAL_BLOCKED_TOOL, GOAL_COMPLETE_TOOL, type GoalState } from "../goal.js";
import {
  createFakeCtx,
  createFakePi,
  fire,
  lastNotification,
  runCommand,
  withEnv,
} from "./helpers/fake-pi.js";
import type { FakePi } from "./helpers/fake-pi.js";

function lastEntryData(fake: FakePi): GoalState {
  const entries = fake.appendedEntries;
  const last = entries[entries.length - 1];
  if (last === undefined) throw new Error("no appended entries");
  return last.data as GoalState;
}

function latestGoalId(fake: FakePi): string {
  return lastEntryData(fake).goalId;
}

async function startGoal(fake: FakePi, args: string, activeTools?: string[]): Promise<any> {
  const ctx = createFakeCtx({ activeTools: activeTools ?? fake.activeTools });
  await runCommand(fake, "goal", args, ctx);
  return ctx;
}

describe("goal lifecycle", () => {
  test("start persists state and queues the first turn", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    const ctx = await startGoal(fake, "ship the feature --max-turns 3");
    expect(fake.appendedEntries.length).toBe(1);
    expect(lastEntryData(fake).condition).toBe("ship the feature");
    expect(lastEntryData(fake).maxTurns).toBe(3);
    expect(lastEntryData(fake).status).toBe("active");
    expect(fake.sentUserMessages.length).toBe(1);
    const first = fake.sentUserMessages[0];
    expect(typeof first?.content).toBe("string");
    expect(first?.content as string).toContain("ship the feature");
    expect(lastNotification(ctx)).toContain("turns: 0/3");
  });

  test("tools stay hidden until first /goal, then activate", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    expect(fake.activeTools).not.toContain(GOAL_COMPLETE_TOOL);
    expect(fake.activeTools).not.toContain(GOAL_BLOCKED_TOOL);
    await startGoal(fake, "do the thing");
    expect(fake.activeTools).toContain(GOAL_COMPLETE_TOOL);
    expect(fake.activeTools).toContain(GOAL_BLOCKED_TOOL);
  });

  test("idle continuation queues exactly one turn per settled point", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    await startGoal(fake, "do the thing");
    expect(fake.sentUserMessages.length).toBe(1);
    const ctx = createFakeCtx();
    await fire(fake, "turn_end", { type: "turn_end" }, ctx);
    const before = fake.sentUserMessages.length;
    await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
    expect(fake.sentUserMessages.length).toBe(before + 1);
  });

  test("goal_complete needs the current id and non-empty evidence", async () => {
    // Verification off: covers the #8 fallback path (claim ends the goal).
    await withEnv({ PI_GOAL_VERIFY: "0" }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const stale = await tool.execute("t1", { goal_id: "deadbeef", evidence: "done" });
      expect(stale.isError).toBe(true);
      expect(stale.content[0]?.type).toBe("text");
      const id = latestGoalId(fake);
      const empty = await tool.execute("t2", { goal_id: id, evidence: "   " });
      expect(empty.isError).toBe(true);
      const ok = await tool.execute("t3", { goal_id: id, evidence: "tests pass" });
      expect(ok.isError ?? false).toBe(false);
      expect(lastEntryData(fake).status).toBe("complete");
    });
  });

  test("goal_blocked ends the goal and stops continuation", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    await startGoal(fake, "do the thing");
    const tool = fake.tools.get(GOAL_BLOCKED_TOOL);
    if (tool === undefined) throw new Error("goal_blocked not registered");
    const id = latestGoalId(fake);
    const ok = await tool.execute("t1", { goal_id: id, reason: "API is down" });
    expect(ok.isError ?? false).toBe(false);
    expect(lastEntryData(fake).status).toBe("blocked");
    const before = fake.sentUserMessages.length;
    await fire(fake, "agent_settled", { type: "agent_settled" }, createFakeCtx());
    expect(fake.sentUserMessages.length).toBe(before);
  });

  test("complete goals never continue again (no goal anxiety)", async () => {
    // Verification off: the claim itself completes, then silence.
    await withEnv({ PI_GOAL_VERIFY: "0" }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      await tool.execute("t1", { goal_id: latestGoalId(fake), evidence: "done" });
      const before = fake.sentUserMessages.length;
      const ctx = createFakeCtx();
      await fire(fake, "turn_end", { type: "turn_end" }, ctx);
      await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
      await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
      expect(fake.sentUserMessages.length).toBe(before);
    });
  });

  test("budget sends one wrap-up turn then stops", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    await startGoal(fake, "do the thing --max-turns 3");
    const ctx = createFakeCtx();
    for (let i = 0; i < 3; i++) {
      await fire(fake, "turn_end", { type: "turn_end" }, ctx);
    }
    const beforeWrapUp = fake.sentUserMessages.length;
    await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
    expect(fake.sentUserMessages.length).toBe(beforeWrapUp + 1);
    const wrapUp = fake.sentUserMessages[fake.sentUserMessages.length - 1];
    expect(wrapUp?.content as string).toContain("wrap-up");
    expect(lastEntryData(fake).status).toBe("budget_limited");
    // Wrap-up turn settles: no further continuation ever.
    await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
    await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
    expect(fake.sentUserMessages.length).toBe(beforeWrapUp + 1);
  });

  test("pause stops continuation, resume restarts it", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    await startGoal(fake, "do the thing");
    const ctx = createFakeCtx({ activeTools: fake.activeTools });
    await runCommand(fake, "goal", "pause", ctx);
    expect(lastNotification(ctx)).toContain("paused");
    const before = fake.sentUserMessages.length;
    await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
    expect(fake.sentUserMessages.length).toBe(before);
    await runCommand(fake, "goal", "resume", ctx);
    expect(lastNotification(ctx)).toContain("resumed");
    expect(fake.sentUserMessages.length).toBe(before + 1);
  });

  test("clear stops continuation right away", async () => {
    const fake = createFakePi();
    activate(fake.pi);
    await startGoal(fake, "do the thing");
    const ctx = createFakeCtx({ activeTools: fake.activeTools });
    await runCommand(fake, "goal", "clear", ctx);
    expect(lastNotification(ctx)).toContain("no further continuation");
    expect(fake.activeTools).not.toContain(GOAL_COMPLETE_TOOL);
    const before = fake.sentUserMessages.length;
    await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
    expect(fake.sentUserMessages.length).toBe(before);
  });

  test("state survives reload via session entries", async () => {
    const first = createFakePi();
    activate(first.pi);
    await startGoal(first, "do the thing --max-turns 5");
    const persisted = first.appendedEntries.map((e) => ({
      type: "custom",
      customType: e.customType,
      data: e.data,
    }));
    const second = createFakePi();
    activate(second.pi);
    const ctx = createFakeCtx({ entries: persisted, activeTools: ["read", "bash"] });
    await fire(second, "session_start", { type: "session_start", reason: "reload" }, ctx);
    expect(second.activeTools).toContain(GOAL_COMPLETE_TOOL);
    const showCtx = createFakeCtx();
    await runCommand(second, "goal", "", showCtx);
    expect(lastNotification(showCtx)).toContain("do the thing");
    expect(lastNotification(showCtx)).toContain("active");
  });
});
