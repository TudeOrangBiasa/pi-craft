/** Durable runs: restart restores interrupted runs; per-agent timeouts end runs as `timeout`. */

import { rmSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { AgentManager } from "../src/agent-manager.js";
import { openPersistedChildSession, setRememberAgents } from "../src/agent-runner.js";
import { loadInterrupted, toPersistedRun, type PersistedRun } from "../src/run-store.js";
import { getStatusNote } from "../src/status-note.js";
import type { AgentRecord } from "../src/types.js";
import {
  activateExtension,
  assistantTextMessage,
  assistantToolUseMessage,
  createFakeModel,
  createFakePi,
  createTestCtx,
  createTestRuntime,
  executeTool,
  installScriptedProvider,
  resetSubagentTestState,
  resultText,
  useTempCwd,
  type FakePi,
} from "./helpers/fake-harness.js";

let cwd = "";
let fake: FakePi;
let ctx: any;
let tools: Map<string, any>;
let shutdown = async () => {};
let model: any;

beforeEach(async () => {
  cwd = useTempCwd("subagents-durable-");
  model = createFakeModel();
  const runtime = await createTestRuntime();
  installScriptedProvider(runtime, model, ({ index }) => {
    const text = `reply-${index}`;
    return { message: assistantTextMessage(model, text), deltas: [text] };
  });
  fake = createFakePi();
  ctx = createTestCtx({ cwd, model, runtime });
  const activated = await activateExtension(fake, ctx);
  tools = activated.tools;
  shutdown = activated.shutdown;
});

afterEach(async () => {
  await shutdown();
  resetSubagentTestState();
  rmSync(cwd, { recursive: true, force: true });
});

test("persist → new manager → load restores running runs as interrupted", () => {
  // A run record mid-flight, snapshotted as the manager persists on every
  // status change — then replayed into a fresh manager after a "restart".
  const record: AgentRecord = {
    id: "agent-durable-1",
    type: "general-purpose",
    description: "durable work",
    status: "running",
    toolUses: 3,
    startedAt: Date.now() - 60_000,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0, cost: 0 },
    compactionCount: 0,
    isBackground: true,
    resultConsumed: false,
    result: "partial answer so far",
    sessionFile: "/tmp/sessions/abc.jsonl",
    cwd,
  };
  const snapshot: PersistedRun = toPersistedRun(record);
  const entries = [{ type: "custom", customType: "subagents:run", data: snapshot }];
  const interrupted = loadInterrupted({ getBranch: () => entries });
  expect(interrupted.map((r) => r.id)).toContain("agent-durable-1");

  const next = new AgentManager();
  const restored = next.restoreInterrupted(interrupted);
  const revived = restored.find((r) => r.id === "agent-durable-1");
  expect(revived?.status).toBe("interrupted");
  // Fail-closed: the id, session coordinate, and partial output survive.
  expect(revived?.sessionFile).toBe("/tmp/sessions/abc.jsonl");
  expect(revived?.result).toBe("partial answer so far");
  // …and the note is honest: never an empty success.
  expect(getStatusNote(revived!.status)).toContain("INTERRUPTED");
});

test("a settled run does not replay as interrupted", () => {
  const settled: AgentRecord = {
    id: "agent-settled-1",
    type: "general-purpose",
    description: "settled work",
    status: "completed",
    toolUses: 1,
    startedAt: Date.now() - 60_000,
    completedAt: Date.now(),
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0, cost: 0 },
    compactionCount: 0,
    isBackground: true,
    resultConsumed: false,
    result: "done",
  };
  const stale = { ...toPersistedRun(settled), status: "running" as const };
  const entries = [
    { type: "custom", customType: "subagents:run", data: stale },
    { type: "custom", customType: "subagents:run", data: toPersistedRun(settled) },
  ];
  const interrupted = loadInterrupted({ getBranch: () => entries });
  expect(interrupted).toHaveLength(0);
});

test("session_start surfaces interrupted runs with a one-line notice", async () => {
  // Seed the session branch with a run snapshot that never settled, then a
  // fresh activation replays it and notifies the main agent once.
  ctx.sessionManager.appendCustomEntry("subagents:run", {
    id: "agent-stale-1",
    type: "general-purpose",
    description: "stale work",
    status: "running",
    startedAt: Date.now() - 60_000,
    toolUses: 3,
  });
  const fresh = createFakePi();
  await activateExtension(fresh, ctx);
  const notices = fresh.sentMessages.filter((m: any) => m?.customType === "subagents-interrupted");
  expect(notices).toHaveLength(1);
  expect(String((notices[0] as any).content)).toContain("agent-stale-1");
});

test("compact and tree re-restore without duplicates or notices", async () => {
  ctx.sessionManager.appendCustomEntry("subagents:run", {
    id: "agent-compact-1",
    type: "general-purpose",
    description: "compact work",
    status: "running",
    startedAt: Date.now() - 60_000,
    toolUses: 2,
  });
  const fresh = createFakePi();
  await activateExtension(fresh, ctx);
  expect(
    fresh.sentMessages.filter((m: any) => m?.customType === "subagents-interrupted"),
  ).toHaveLength(1);
  // Compact and tree re-run the restore: same id skipped, no extra notice.
  await fresh.handlers.get("session_compact")?.({}, ctx);
  await fresh.handlers.get("session_tree")?.({}, ctx);
  expect(
    fresh.sentMessages.filter((m: any) => m?.customType === "subagents-interrupted"),
  ).toHaveLength(1);
});

test("compact and tree never resurrect a settled run", async () => {
  const settled: AgentRecord = {
    id: "agent-done-1",
    type: "general-purpose",
    description: "done work",
    status: "completed",
    toolUses: 1,
    startedAt: Date.now() - 60_000,
    completedAt: Date.now(),
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0, cost: 0 },
    compactionCount: 0,
    isBackground: true,
    resultConsumed: false,
    result: "done",
  };
  ctx.sessionManager.appendCustomEntry("subagents:run", toPersistedRun(settled));
  const fresh = createFakePi();
  await activateExtension(fresh, ctx);
  await fresh.handlers.get("session_compact")?.({}, ctx);
  await fresh.handlers.get("session_tree")?.({}, ctx);
  expect(
    fresh.sentMessages.filter((m: any) => m?.customType === "subagents-interrupted"),
  ).toHaveLength(0);
});

test("expired run ends as timeout and reports like a failure", async () => {
  // No gate: each turn answers with a tool call, forever. The run's own
  // deadline fires session.abort() mid-loop, which pi settles between turns —
  // the awaited prompt resolves and the record routes to `timeout`.
  const runtime = ctx.modelRegistry.runtime;
  installScriptedProvider(runtime, model, ({ index }) => ({
    message: assistantToolUseMessage(model, `tc-${index}`, "read", { path: "notes.txt" }),
  }));

  const result = await executeTool(
    tools.get("Agent"),
    {
      prompt: "loop forever",
      description: "looping work",
      subagent_type: "general-purpose",
      run_in_background: false,
      isolated: true,
      timeout_ms: 300,
    },
    ctx,
  );
  expect(result.details.status).toBe("timeout");
  const text = resultText(result);
  expect(text).toContain("timed out");
  expect(text).toContain("run exceeded its");
});

test("resume reopens the same session file with finished tool results kept", async () => {
  // Persisted children write real session files. Spawn at the manager level
  // (so the record — and its sessionFile coordinate — is directly visible),
  // evict the session as a restart would, restore as `interrupted`, then
  // resume: the reopened session must carry the finished first turn.
  setRememberAgents(true);
  const manager = new AgentManager();
  const { id, record } = await manager.spawnAndWait(fake.pi, ctx, "general-purpose", "first turn", {
    description: "persisted",
  });
  expect(record.status).toBe("completed");
  const sessionFile = record.sessionFile;
  expect(typeof sessionFile).toBe("string");

  // Simulate the restart: the live session is gone, the file remains.
  record.session = undefined;
  const restored = manager.restoreInterrupted(
    loadInterrupted({
      getBranch: () => [
        {
          type: "custom",
          customType: "subagents:run",
          data: { ...toPersistedRun({ ...record, status: "running" }), sessionFile },
        },
      ],
    }),
  );
  // Already registered under this manager — restore skips it; flip manually
  // to the post-restart shape (fresh manager path is covered above).
  expect(restored).toHaveLength(0);
  record.status = "interrupted";

  const session = await openPersistedChildSession(ctx, "general-purpose", sessionFile!, {
    pi: fake.pi,
    agentId: id,
  });
  try {
    const texts = session.messages
      .filter((m: any) => m.role === "assistant")
      .map((m: any) => JSON.stringify(m.content ?? ""));
    expect(texts.join("\n")).toContain("reply-1");
  } finally {
    session.dispose?.();
  }
  await manager.dispose();
});
