import { describe, expect, test } from "bun:test";
import activate, { GOAL_BLOCKED_TOOL, GOAL_COMPLETE_TOOL, type GoalState } from "../goal.js";
import {
  createFakeCtx,
  createFakePi,
  fire,
  lastNotification,
  runCommand,
  withEnv,
  type FakePi,
} from "./helpers/fake-pi.js";

function lastEntryData(fake: FakePi): GoalState {
  const entries = fake.appendedEntries;
  const last = entries[entries.length - 1];
  if (last === undefined) throw new Error("no appended entries");
  return last.data as GoalState;
}

function latestGoalId(fake: FakePi): string {
  return lastEntryData(fake).goalId;
}

async function startGoal(fake: FakePi, args: string): Promise<any> {
  const ctx = createFakeCtx({ activeTools: fake.activeTools });
  await runCommand(fake, "goal", args, ctx);
  return ctx;
}

function toolText(result: any): string {
  const first = result?.content?.[0];
  return first?.type === "text" ? (first.text as string) : "";
}

describe("verifier gate", () => {
  test("goal_complete with verification on parks pending and returns spawn instructions", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      const result = await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      expect(result.isError ?? false).toBe(false);
      // The worker's claim must NOT complete the goal: still active, pending verdict.
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
      // Instructions carry the spawn surface the worker must use.
      const text = toolText(result);
      expect(text).toContain("Agent");
      expect(text).toContain(id);
      expect(text).toContain("tests pass");
    });
  });

  /** Fire a tool_result event as Pi would after an Agent tool call settles. */
  async function fireAgentResult(
    fake: FakePi,
    input: Record<string, unknown>,
    text: string,
  ): Promise<unknown> {
    return fire(
      fake,
      "tool_result",
      {
        type: "tool_result",
        toolCallId: "call-1",
        toolName: "Agent",
        input,
        content: [{ type: "text", text }],
        isError: false,
      },
      createFakeCtx(),
    );
  }

  test("PASS verdict completes the goal", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      expect(lastEntryData(fake).status).toBe("active");
      await fireAgentResult(
        fake,
        { subagent_type: "Explore", description: `verify goal ${id}`, run_in_background: false },
        "checked the repo\nGOAL_VERDICT: PASS",
      );
      expect(lastEntryData(fake).status).toBe("complete");
      expect(lastEntryData(fake).pendingVerdict).toBe(false);
      expect(lastEntryData(fake).lastVerdict?.verdict).toBe("PASS");
    });
  });

  test("FAIL verdict feeds the missing items back as the next continuation", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      const before = fake.sentUserMessages.length;
      await fireAgentResult(
        fake,
        { subagent_type: "Explore", description: `verify goal ${id}`, run_in_background: false },
        "looked around\nGOAL_VERDICT: FAIL(no test covers the retry path)",
      );
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(false);
      expect(fake.sentUserMessages.length).toBe(before + 1);
      const last = fake.sentUserMessages[fake.sentUserMessages.length - 1];
      expect(last?.content as string).toContain("no test covers the retry path");
    });
  });

  test("IMPOSSIBLE verdict blocks the goal", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(
        fake,
        { subagent_type: "Explore", description: `verify goal ${id}`, run_in_background: false },
        "checked\nGOAL_VERDICT: IMPOSSIBLE(upstream API removed the endpoint)",
      );
      expect(lastEntryData(fake).status).toBe("blocked");
      expect(lastEntryData(fake).pendingVerdict).toBe(false);
    });
  });

  test("no continuation queues while a verdict is pending", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      await tool.execute("t1", { goal_id: latestGoalId(fake), evidence: "tests pass" });
      const before = fake.sentUserMessages.length;
      await fire(fake, "agent_settled", { type: "agent_settled" }, createFakeCtx());
      expect(fake.sentUserMessages.length).toBe(before);
    });
  });

  test("re-claiming while pending re-parks with the latest evidence", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "first try" });
      const again = await tool.execute("t2", { goal_id: id, evidence: "second try" });
      expect(again.isError ?? false).toBe(false);
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
      expect(lastEntryData(fake).lastEvidence).toBe("second try");
    });
  });

  test("goal_blocked while pending clears the pending flag", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const complete = fake.tools.get(GOAL_COMPLETE_TOOL);
      const blocked = fake.tools.get(GOAL_BLOCKED_TOOL);
      if (complete === undefined || blocked === undefined) throw new Error("tools not registered");
      const id = latestGoalId(fake);
      await complete.execute("t1", { goal_id: id, evidence: "tests pass" });
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
      await blocked.execute("t2", { goal_id: id, reason: "API went down mid-verify" });
      expect(lastEntryData(fake).status).toBe("blocked");
      expect(lastEntryData(fake).pendingVerdict).toBe(false);
    });
  });

  test("two consecutive FAILs with no new evidence block the goal", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      const input = {
        subagent_type: "Explore",
        description: `verify goal ${id}`,
        run_in_background: false,
      };
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(fake, input, "checked\nGOAL_VERDICT: FAIL(missing retry test)");
      expect(lastEntryData(fake).status).toBe("active");
      // Worker re-claims with the same evidence: no progress.
      await tool.execute("t2", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(fake, input, "checked again\nGOAL_VERDICT: FAIL(missing retry test)");
      expect(lastEntryData(fake).status).toBe("blocked");
      expect(lastEntryData(fake).lastVerdict?.verdict).toBe("FAIL");
    });
  });

  test("new evidence after FAIL resets the streak", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      const input = {
        subagent_type: "Explore",
        description: `verify goal ${id}`,
        run_in_background: false,
      };
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(fake, input, "checked\nGOAL_VERDICT: FAIL(missing retry test)");
      await tool.execute("t2", { goal_id: id, evidence: "tests pass, retry test added" });
      await fireAgentResult(fake, input, "checked\nGOAL_VERDICT: FAIL(docs still missing)");
      // Different evidence: streak restarts at 1, goal still active.
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).failStreak).toBe(1);
    });
  });

  test("verification on: the claim alone never completes (negative test)", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await tool.execute("t2", { goal_id: id, evidence: "more evidence" });
      await tool.execute("t3", { goal_id: id, evidence: "even more evidence" });
      const ctx = createFakeCtx();
      await fire(fake, "turn_end", { type: "turn_end" }, ctx);
      await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
      await fire(fake, "agent_settled", { type: "agent_settled" }, ctx);
      for (const entry of fake.appendedEntries) {
        expect((entry.data as GoalState).status).not.toBe("complete");
      }
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
    });
  });

  test("verdicts from other agent types are ignored", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      // A general-purpose agent's PASS-looking text is not a verdict.
      await fireAgentResult(
        fake,
        {
          subagent_type: "general-purpose",
          description: `verify goal ${id}`,
          run_in_background: false,
        },
        "done\nGOAL_VERDICT: PASS",
      );
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
    });
  });

  test("result text without the marker is not a verdict", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(
        fake,
        { subagent_type: "Explore", description: `verify goal ${id}`, run_in_background: false },
        "looks good to me, PASS",
      );
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
    });
  });

  test("error results and other goals' verifiers are ignored", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      // Error result, even with a marker.
      await fire(
        fake,
        "tool_result",
        {
          type: "tool_result",
          toolCallId: "call-err",
          toolName: "Agent",
          input: {
            subagent_type: "Explore",
            description: `verify goal ${id}`,
            run_in_background: false,
          },
          content: [{ type: "text", text: "GOAL_VERDICT: PASS" }],
          isError: true,
        },
        createFakeCtx(),
      );
      // Right shape, wrong goal.
      await fireAgentResult(
        fake,
        { subagent_type: "Explore", description: "verify goal deadbeef", run_in_background: false },
        "GOAL_VERDICT: PASS",
      );
      expect(lastEntryData(fake).status).toBe("active");
      expect(lastEntryData(fake).pendingVerdict).toBe(true);
    });
  });

  test("/goal status shows the last verdict and its reason", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(fake);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(
        fake,
        { subagent_type: "Explore", description: `verify goal ${id}`, run_in_background: false },
        "checked\nGOAL_VERDICT: FAIL(missing retry test)",
      );
      const ctx = createFakeCtx();
      await runCommand(fake, "goal", "", ctx);
      expect(lastNotification(ctx)).toContain("FAIL");
      expect(lastNotification(ctx)).toContain("missing retry test");
    });
  });

  test("verifier model and timeout come from config", async () => {
    await withEnv(
      { PI_GOAL_VERIFY_MODEL: "haiku", PI_GOAL_VERIFY_TIMEOUT_MS: "90000" },
      async () => {
        const fake = createFakePi();
        activate(fake.pi);
        await startGoal(fake, "do the thing");
        const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
        if (tool === undefined) throw new Error("goal_complete not registered");
        const result = await tool.execute("t1", { goal_id: latestGoalId(fake), evidence: "x" });
        const text = toolText(result);
        expect(text).toContain('model: "haiku"');
        expect(text).toContain("timeout_ms: 90000");
      },
    );
  });

  test("verification off falls back to #8: the claim completes", async () => {
    await withEnv({ PI_GOAL_VERIFY: "0" }, async () => {
      const fake = createFakePi();
      activate(fake.pi);
      await startGoal(fake, "do the thing");
      const tool = fake.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const result = await tool.execute("t1", { goal_id: latestGoalId(fake), evidence: "done" });
      expect(toolText(result)).toContain("complete — no further continuation");
      expect(lastEntryData(fake).status).toBe("complete");
      expect(lastEntryData(fake).pendingVerdict).toBe(false);
    });
  });

  test("verdict state survives reload via session entries", async () => {
    await withEnv({ PI_GOAL_VERIFY: undefined }, async () => {
      const first = createFakePi();
      activate(first.pi);
      await startGoal(first, "do the thing");
      const tool = first.tools.get(GOAL_COMPLETE_TOOL);
      if (tool === undefined) throw new Error("goal_complete not registered");
      const id = latestGoalId(first);
      await tool.execute("t1", { goal_id: id, evidence: "tests pass" });
      await fireAgentResult(
        first,
        { subagent_type: "Explore", description: `verify goal ${id}`, run_in_background: false },
        "checked\nGOAL_VERDICT: FAIL(missing retry test)",
      );
      const persisted = first.appendedEntries.map((e) => ({
        type: "custom",
        customType: e.customType,
        data: e.data,
      }));
      const second = createFakePi();
      activate(second.pi);
      const ctx = createFakeCtx({ entries: persisted, activeTools: ["read", "bash"] });
      await fire(second, "session_start", { type: "session_start", reason: "reload" }, ctx);
      const showCtx = createFakeCtx();
      await runCommand(second, "goal", "", showCtx);
      expect(lastNotification(showCtx)).toContain("FAIL");
      expect(lastNotification(showCtx)).toContain("missing retry test");
    });
  });
});
